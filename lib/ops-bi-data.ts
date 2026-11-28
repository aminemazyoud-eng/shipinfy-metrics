/**
 * lib/ops-bi-data.ts — alimentation du dashboard « Control Tower » par l'API (plus aucun export CSV).
 * Mode normal : tables Ops* (copie du back-office faite par lib/ops-sync.ts), source lue = ACTIVE_SOURCE.
 * Mode dev OPS_DIRECT=1 : lecture directe de l'API du back-office (mock) — ignoré en production.
 * Renvoie des lignes `BiRaw` : l'équivalent des 22 colonnes de l'ancien CSV.
 */
import { prisma } from '@/lib/prisma'
import { ACTIVE_SOURCE, directMode, loadHubs, loadDrivers } from '@/lib/ops-data'
import { opsSyncConfig, type BoOrder } from '@/lib/ops-sync'
import { dayStartUtc, addDays } from '@/lib/tz'
import { IMPORT_SOURCE } from '@/lib/ops-import'
import type { BiRaw } from '@/lib/ops-bi'

export const BI_MAX_DAYS = 366
export const BI_MAX_ROWS = 60_000

/** Source lue : « active » = API du back-office (OPS_ACTIVE_SOURCE) ; « import » = fichier d'export importé. */
export type BiSourceKey = 'active' | 'import'
export const parseSourceKey = (v: string | null | undefined): BiSourceKey => (v === 'import' ? 'import' : 'active')
/** Source affichée par défaut (avant tout choix de l'utilisateur) : BI_DEFAULT_SOURCE=import quand le Dashboard est alimenté par l'export envoyé automatiquement. */
export const biDefaultSource = (): BiSourceKey => (process.env.BI_DEFAULT_SOURCE === 'import' ? 'import' : 'active')
const resolveSource = (k: BiSourceKey) => (k === 'import' ? IMPORT_SOURCE : ACTIVE_SOURCE)

export interface BiPayload { rows: BiRaw[]; truncated: boolean; source: string; lastSync: string | null; from: string; to: string }

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

async function boFetch<T>(path: string): Promise<T> {
  const { url, key } = opsSyncConfig()
  const r = await fetch(`${url}${path}`, { headers: { 'x-api-key': key }, cache: 'no-store', signal: AbortSignal.timeout(25_000) })
  if (!r.ok) throw new Error(`back-office HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export async function loadBiOrders(from: string, to: string, includeCancelled = false, sourceKey: BiSourceKey = 'active'): Promise<BiPayload> {
  const t0 = dayStartUtc(from), t1 = dayStartUtc(addDays(to, 1)), src = resolveSource(sourceKey)

  // ── Dev : lecture directe du back-office (uniquement pour la source « active ») ──
  if (directMode() && sourceKey === 'active') {
    const [hubs, drivers] = await Promise.all([loadHubs(), loadDrivers()])
    const hubBy = new Map(hubs.map(h => [h.code, h])), drvBy = new Map(drivers.map(d => [d.code, d]))
    const out: BiRaw[] = []
    let cursor: string | null = null
    for (let i = 0; i < 40; i++) {
      const page: { data: BoOrder[]; hasMore: boolean; nextCursor: string | null } = await boFetch(`/api/v1/orders?limit=5000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      for (const o of page.data) {
        if (!includeCancelled && o.status === 'CANCELLED') continue
        const created = o.createdAt ? Date.parse(o.createdAt) : NaN, slot = Date.parse(o.slotStart)
        const ref = Number.isFinite(created) ? created : slot
        if (!(ref >= t0 && ref < t1)) continue
        const h = hubBy.get(o.hubCode ?? ''), d = drvBy.get(o.courierRef ?? '')
        out.push({
          id: o.id, hub: h?.name ?? o.hubCode ?? null, hubLat: h?.lat ?? null, hubLng: h?.lng ?? null, status: o.status,
          createdAt: o.createdAt ?? null, assignedAt: o.assignedAt ?? null, inTransportAt: o.inTransportAt ?? null, startDeliveryAt: o.startDeliveryAt ?? null, deliveredAt: o.deliveredAt ?? null,
          slotStart: o.slotStart, slotEnd: o.slotEnd, attempt: o.attemptCount ?? 1, amount: o.amount ?? null, lat: o.lat ?? null, lng: o.lng ?? null,
          phone: o.customerPhone ?? o.customerPhoneNumber ?? null, firstName: o.customerName?.split(' ')[0] ?? null,
          driverId: o.courierRef ?? null, driver: d ? `${d.firstName} ${d.lastName}`.trim() : (o.courierRef ?? null), updatedAt: o.updatedAt ?? o.deliveredAt ?? null,
        })
        if (out.length >= BI_MAX_ROWS) return { rows: out, truncated: true, source: 'mock (direct)', lastSync: new Date().toISOString(), from, to }
      }
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    return { rows: out, truncated: false, source: 'mock (direct)', lastSync: new Date().toISOString(), from, to }
  }

  // ── Normal : tables Ops* ──
  const [orders, hubs, sync] = await Promise.all([
    prisma.opsOrder.findMany({
      where: {
        source: src,
        ...(includeCancelled ? {} : { status: { not: 'CANCELLED' } }),
        OR: [{ createdAtSrc: { gte: new Date(t0), lt: new Date(t1) } }, { createdAtSrc: null, slotStart: { gte: new Date(t0), lt: new Date(t1) } }],
      },
      orderBy: [{ createdAtSrc: 'asc' }, { externalId: 'asc' }],
      take: BI_MAX_ROWS + 1,
      select: {
        externalId: true, hubCode: true, status: true, createdAtSrc: true, assignedAt: true, inTransportAt: true, startDeliveryAt: true, deliveredAt: true,
        slotStart: true, slotEnd: true, attemptCount: true, amount: true, lat: true, lng: true, customerPhone: true, customerName: true, courierRef: true,
        sourceUpdatedAt: true, driver: { select: { code: true, firstName: true, lastName: true } },
      },
    }),
    prisma.opsHub.findMany({ select: { code: true, name: true, lat: true, lng: true } }),
    prisma.opsSyncRun.findFirst({ where: { source: src, ok: true }, orderBy: { startedAt: 'desc' }, select: { finishedAt: true, startedAt: true } }),
  ])
  const hubBy = new Map(hubs.map(h => [h.code, h]))
  const truncated = orders.length > BI_MAX_ROWS
  const rows: BiRaw[] = orders.slice(0, BI_MAX_ROWS).map(o => {
    const h = hubBy.get(o.hubCode ?? '')
    const code = o.driver?.code ?? o.courierRef ?? null
    return {
      id: o.externalId, hub: h?.name ?? o.hubCode ?? null, hubLat: h?.lat ?? null, hubLng: h?.lng ?? null, status: o.status,
      createdAt: iso(o.createdAtSrc), assignedAt: iso(o.assignedAt), inTransportAt: iso(o.inTransportAt), startDeliveryAt: iso(o.startDeliveryAt), deliveredAt: iso(o.deliveredAt),
      slotStart: iso(o.slotStart), slotEnd: iso(o.slotEnd), attempt: o.attemptCount, amount: o.amount, lat: o.lat, lng: o.lng,
      phone: o.customerPhone, firstName: o.customerName?.split(' ')[0] ?? null,
      driverId: code, driver: o.driver ? `${o.driver.firstName} ${o.driver.lastName}`.trim() : (o.courierRef ?? null), updatedAt: iso(o.sourceUpdatedAt),
    }
  })
  return { rows, truncated, source: src, lastSync: iso(sync?.finishedAt ?? sync?.startedAt ?? null), from, to }
}

/**
 * Empreinte légère des données d'une période (nombre de commandes + dernière modification de chaque horodatage de statut).
 * Sert au rafraîchissement automatique de l'écran : le navigateur l'interroge toutes les ~10 s et ne recharge les commandes que si elle change
 * (donc dès qu'une commande arrive par push, est synchronisée par pull, ou change de statut côté terrain).
 */
export async function biVersion(from: string, to: string, sourceKey: BiSourceKey = 'active'): Promise<string> {
  const t0 = dayStartUtc(from), t1 = dayStartUtc(addDays(to, 1)), src = resolveSource(sourceKey)
  if (directMode() && sourceKey === 'active') {
    const p = await loadBiOrders(from, to, true)
    let h = 0
    for (const r of p.rows) for (const c of `${r.id}|${r.status}|${r.driverId}|${r.deliveredAt}|${r.updatedAt}`) h = (h * 31 + c.charCodeAt(0)) | 0
    return `d:${p.rows.length}:${h}`
  }
  const a = await prisma.opsOrder.aggregate({
    where: { source: src, OR: [{ createdAtSrc: { gte: new Date(t0), lt: new Date(t1) } }, { createdAtSrc: null, slotStart: { gte: new Date(t0), lt: new Date(t1) } }] },
    _count: { _all: true },
    _max: { sourceUpdatedAt: true, syncedAt: true, assignedAt: true, inTransportAt: true, startDeliveryAt: true, deliveredAt: true, noShowAt: true },
  })
  const m = a._max
  return [a._count._all, m.sourceUpdatedAt, m.syncedAt, m.assignedAt, m.inTransportAt, m.startDeliveryAt, m.deliveredAt, m.noShowAt].map(v => (v instanceof Date ? v.getTime() : v ?? 0)).join(':')
}

export interface BiSourceInfo { key: BiSourceKey; label: string; source: string; count: number | null; from: string | null; to: string | null; lastSync: string | null }

/** Sources disponibles pour le Dashboard, avec leur volume, la période couverte et leur dernière mise à jour. */
export async function biSources(): Promise<BiSourceInfo[]> {
  const keys: { key: BiSourceKey; label: string }[] = [{ key: 'active', label: 'API back-office' }, { key: 'import', label: 'Import fichier' }]
  const out: BiSourceInfo[] = []
  for (const { key, label } of keys) {
    const source = resolveSource(key)
    if (key === 'active' && directMode()) { out.push({ key, label, source: 'mock (direct)', count: null, from: null, to: null, lastSync: new Date().toISOString() }); continue }
    try {
      const [agg, run] = await Promise.all([
        prisma.opsOrder.aggregate({ where: { source }, _count: { _all: true }, _min: { createdAtSrc: true, slotStart: true }, _max: { createdAtSrc: true, slotStart: true } }),
        prisma.opsSyncRun.findFirst({ where: { source, ok: true }, orderBy: { startedAt: 'desc' }, select: { finishedAt: true, startedAt: true } }),
      ])
      const lo = agg._min.createdAtSrc ?? agg._min.slotStart, hi = agg._max.createdAtSrc ?? agg._max.slotStart
      out.push({ key, label, source, count: agg._count._all, from: lo ? lo.toISOString().slice(0, 10) : null, to: hi ? hi.toISOString().slice(0, 10) : null, lastSync: iso(run?.finishedAt ?? run?.startedAt ?? null) })
    } catch {
      out.push({ key, label, source, count: null, from: null, to: null, lastSync: null })
    }
  }
  return out
}
