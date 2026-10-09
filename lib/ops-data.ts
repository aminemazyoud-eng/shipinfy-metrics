/**
 * lib/ops-data.ts — accès aux données opérationnelles (Module 1)
 *
 * Mode normal : lecture des tables Ops* (alimentées par lib/ops-sync.ts).
 * Mode dev OPS_DIRECT=1 : lecture directe du mock back-office (aucune base requise) — pour développer/tester les écrans
 * sans DATABASE_URL. Ignoré en production.
 */
import { prisma } from '@/lib/prisma'
import { opsSyncConfig } from '@/lib/ops-sync'
import { canonicalSlot } from '@/lib/ops-slots'
import { TERMINAL_STATUSES } from '@/lib/ops-defs'
import type { OrderLite, HubLite, DriverLite } from '@/lib/ops-analytics'

/** Source de données lue par TOUTES les routes (Sprint 17 B4) : évite de mélanger mock et back-office réel dans la même base. */
export const ACTIVE_SOURCE: string = process.env.OPS_ACTIVE_SOURCE ?? process.env.OPS_SOURCE ?? 'mock'

export const directMode = () => process.env.OPS_DIRECT === '1' && process.env.NODE_ENV !== 'production'

interface BoOrder {
  id: string; hubCode: string; city?: string | null; status: string; slotStart: string; slotEnd: string; slotLabel?: string | null
  createdAt?: string | null; deliveredAt?: string | null; noShowAt?: string | null; lat?: number | null; lng?: number | null
  courierRef?: string | null; amount?: number | null; district?: string | null
}

const cache: { orders?: { at: number; data: OrderLite[] } } = {}

async function boFetch<T>(path: string): Promise<T> {
  const { url, key } = opsSyncConfig()
  const r = await fetch(`${url}${path}`, { headers: { 'x-api-key': key }, cache: 'no-store', signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`back-office HTTP ${r.status}`)
  return r.json() as Promise<T>
}

async function directOrders(): Promise<OrderLite[]> {
  if (cache.orders && Date.now() - cache.orders.at < 10_000) return cache.orders.data
  const out: OrderLite[] = []
  let cursor: string | null = null
  for (let i = 0; i < 40; i++) {
    const page: { data: BoOrder[]; hasMore: boolean; nextCursor: string | null } =
      await boFetch(`/api/v1/orders?limit=5000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    for (const o of page.data) out.push({
      id: o.id, hubCode: o.hubCode, city: o.city ?? null, status: o.status, slotStart: o.slotStart, slotEnd: o.slotEnd, slotLabel: canonicalSlot(o.slotStart),
      createdAt: o.createdAt ?? null, deliveredAt: o.deliveredAt ?? null, noShowAt: o.noShowAt ?? null, lat: o.lat ?? null, lng: o.lng ?? null,
      driverCode: o.courierRef ?? null, amount: o.amount ?? null, district: o.district ?? null,
    })
    cursor = page.nextCursor
    if (!page.hasMore) break
  }
  cache.orders = { at: Date.now(), data: out }
  return out
}

/** Commandes dont le créneau est dans [from, to[ — plus le reliquat non terminé antérieur si `includeOpenBefore`. */
export async function loadOrders(from: Date, to: Date, opts: { includeOpenBefore?: boolean; includeCancelled?: boolean } = {}): Promise<OrderLite[]> {
  if (directMode()) {
    const f = from.getTime(), t1 = to.getTime()
    return (await directOrders()).filter(o => {
      if (o.status === 'CANCELLED' && !opts.includeCancelled) return false // annulée : ni retard ni capacité
      const s = Date.parse(o.slotStart)
      return (s >= f && s < t1) || (opts.includeOpenBefore && s < f && !(TERMINAL_STATUSES as readonly string[]).includes(o.status))
    })
  }
  const rows = await prisma.opsOrder.findMany({
    where: {
      source: ACTIVE_SOURCE,
      ...(opts.includeCancelled ? {} : { status: { not: 'CANCELLED' } }),
      OR: [
        { slotStart: { gte: from, lt: to } },
        ...(opts.includeOpenBefore ? [{ slotStart: { lt: from }, status: { notIn: [...TERMINAL_STATUSES] as string[] } }] : []),
      ],
    },
    select: {
      externalId: true, hubCode: true, city: true, status: true, slotStart: true, slotEnd: true, slotLabel: true, createdAtSrc: true,
      deliveredAt: true, noShowAt: true, lat: true, lng: true, courierRef: true, amount: true, district: true, driver: { select: { code: true } },
    },
  })
  return rows.map(o => ({
    id: o.externalId, hubCode: o.hubCode ?? '', city: o.city, status: o.status, slotStart: o.slotStart.toISOString(), slotEnd: o.slotEnd.toISOString(),
    slotLabel: o.slotLabel, createdAt: o.createdAtSrc?.toISOString() ?? null, deliveredAt: o.deliveredAt?.toISOString() ?? null,
    noShowAt: o.noShowAt?.toISOString() ?? null, lat: o.lat, lng: o.lng, driverCode: o.driver?.code ?? o.courierRef, amount: o.amount, district: o.district,
  }))
}

export async function loadHubs(): Promise<HubLite[]> {
  if (directMode()) return (await boFetch<{ data: HubLite[] }>('/api/v1/hubs')).data
  const rows = await prisma.opsHub.findMany({ where: { active: true }, orderBy: { code: 'asc' } })
  return rows.map(h => ({ code: h.code, name: h.name, city: h.city, lat: h.lat, lng: h.lng }))
}

export async function loadDrivers(): Promise<DriverLite[]> {
  if (directMode()) {
    const r = await boFetch<{ data: { code: string; firstName: string; lastName: string; hubCode: string; vehicle?: { type?: string } }[] }>('/api/v1/couriers')
    return r.data.map(d => ({ code: d.code, firstName: d.firstName, lastName: d.lastName, hubCode: d.hubCode, vehicleType: d.vehicle?.type ?? null }))
  }
  const rows = await prisma.opsDriver.findMany({ where: { status: 'active', jobType: 'chauffeur' }, include: { hub: { select: { code: true } }, vehicle: { select: { type: true } } } })
  return rows.map(d => ({ code: d.code, firstName: d.firstName, lastName: d.lastName, hubCode: d.hub?.code ?? null, vehicleType: d.vehicle?.type ?? null }))
}

/** Horloge « serveur ». En dev direct, on suit l'horloge (voyageable) du mock pour que les tests restent cohérents. */
export async function opsNow(): Promise<number> {
  if (directMode()) {
    try { return Date.parse((await boFetch<{ serverTime: string }>('/health')).serverTime) } catch { /* repli */ }
  }
  return Date.now()
}
