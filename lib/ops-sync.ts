/**
 * lib/ops-sync.ts — Synchronisation incrémentale back-office → OpsOrder (Module 0)
 *
 * Contrat attendu de l'API source (mock-backoffice aujourd'hui, back-office Shipinfy demain) :
 *   GET {BACKOFFICE_API_URL}/api/v1/orders?cursor=<ISO|id>&limit=1000   header x-api-key
 *   -> { data: BoOrder[], hasMore, nextCursor, serverTime }
 * Changer de source = changer BACKOFFICE_API_URL / BACKOFFICE_API_KEY / OPS_SOURCE, rien d'autre.
 *
 * Invariants :
 *  - idempotent (upsert sur [source, externalId]) ;
 *  - le curseur n'avance qu'après insertion réussie de la page ;
 *  - chaque transition de statut produit un OpsOrderEvent horodaté à la source (historique + BI) ;
 *  - un livreur affecté par NOTRE dispatch (driverId) n'est jamais écrasé par la source.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export interface BoOrder {
  id: string
  reference?: string | null
  shipper?: string | null
  hubCode?: string | null
  city?: string | null
  district?: string | null
  status: string
  courierRef?: string | null
  slotStart: string
  slotEnd: string
  slotLabel?: string | null
  amount?: number | null
  customerName?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
  cluster?: string | null
  attemptCount?: number | null
  createdAt?: string | null
  assignedAt?: string | null
  inTransportAt?: string | null
  startDeliveryAt?: string | null
  deliveredAt?: string | null
  noShowAt?: string | null
  updatedAt: string
}

export interface OpsSyncResult {
  ok: boolean
  source: string
  fetched: number
  created: number
  updated: number
  events: number
  pages: number
  cursor: string | null
  error?: string
  durationMs: number
}

const RANK: Record<string, number> = { READY_PICKUP: 0, ASSIGNED: 1, IN_TRANSPORT: 2, START_DELIVERY: 3, DELIVERED: 4, NO_SHOW: 4 }
const PAGE_SIZE = 1000
const MAX_PAGES = 30
const d = (v?: string | null) => (v ? new Date(v) : null)

let running = false

export const opsSyncConfig = () => ({
  url: (process.env.BACKOFFICE_API_URL || 'http://localhost:4010').replace(/\/$/, ''),
  key: process.env.BACKOFFICE_API_KEY || 'dev-key',
  source: process.env.OPS_SOURCE || 'mock',
})

/** Étapes franchies par une commande, avec l'horodatage source — sert à reconstruire l'historique. */
function stageEvents(o: BoOrder): { status: string; at: Date }[] {
  const out: { status: string; at: Date }[] = []
  const push = (status: string, v?: string | null) => { if (v) out.push({ status, at: new Date(v) }) }
  push('READY_PICKUP', o.createdAt)
  push('ASSIGNED', o.assignedAt)
  push('IN_TRANSPORT', o.inTransportAt)
  push('START_DELIVERY', o.startDeliveryAt)
  push('DELIVERED', o.deliveredAt)
  push('NO_SHOW', o.noShowAt)
  return out
}

export async function runOpsSync(opts: { full?: boolean } = {}): Promise<OpsSyncResult> {
  const { url, key, source } = opsSyncConfig()
  const t0 = Date.now()
  const res: OpsSyncResult = { ok: false, source, fetched: 0, created: 0, updated: 0, events: 0, pages: 0, cursor: null, durationMs: 0 }
  if (running) return { ...res, error: 'sync déjà en cours', durationMs: 0 }
  running = true

  const run = await prisma.opsSyncRun.create({ data: { source } })
  try {
    const last = opts.full ? null : await prisma.opsSyncRun.findFirst({ where: { source, ok: true, cursorAfter: { not: null } }, orderBy: { startedAt: 'desc' } })
    let cursor: string | null = last?.cursorAfter ?? null
    const drivers = await prisma.opsDriver.findMany({ select: { id: true, code: true } })
    const driverByCode = new Map(drivers.map(x => [x.code, x.id]))

    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (cursor) qs.set('cursor', cursor)
      const r = await fetch(`${url}/api/v1/orders?${qs}`, { headers: { 'x-api-key': key }, cache: 'no-store', signal: AbortSignal.timeout(30_000) })
      if (!r.ok) throw new Error(`back-office HTTP ${r.status}`)
      const body = (await r.json()) as { data: BoOrder[]; hasMore: boolean; nextCursor: string | null }
      res.pages++
      if (!body.data.length) break
      res.fetched += body.data.length

      const existing = await prisma.opsOrder.findMany({
        where: { source, externalId: { in: body.data.map(o => o.id) } },
        select: { id: true, externalId: true, status: true, driverId: true },
      })
      const byExt = new Map(existing.map(e => [e.externalId, e]))

      const toCreate: Prisma.OpsOrderCreateManyInput[] = []
      const updates: ReturnType<typeof prisma.opsOrder.update>[] = []
      const events: { orderId?: string; externalId: string; fromStatus: string | null; toStatus: string; at: Date }[] = []

      for (const o of body.data) {
        const data = {
          reference: o.reference ?? null, shipper: o.shipper ?? null, hubCode: o.hubCode ?? null, city: o.city ?? null, district: o.district ?? null,
          status: o.status, slotStart: new Date(o.slotStart), slotEnd: new Date(o.slotEnd), slotLabel: o.slotLabel ?? null,
          amount: o.amount ?? null, customerName: o.customerName ?? null, address: o.address ?? null, lat: o.lat ?? null, lng: o.lng ?? null,
          cluster: o.cluster ?? null, attemptCount: o.attemptCount ?? 1, courierRef: o.courierRef ?? null,
          createdAtSrc: d(o.createdAt), assignedAt: d(o.assignedAt), inTransportAt: d(o.inTransportAt), startDeliveryAt: d(o.startDeliveryAt),
          deliveredAt: d(o.deliveredAt), noShowAt: d(o.noShowAt), sourceUpdatedAt: new Date(o.updatedAt), syncedAt: new Date(),
        }
        const prev = byExt.get(o.id)
        const bind = o.courierRef ? driverByCode.get(o.courierRef) ?? null : null
        if (!prev) {
          toCreate.push({ source, externalId: o.id, ...data, driverId: bind })
          for (const s of stageEvents(o)) events.push({ externalId: o.id, fromStatus: null, toStatus: s.status, at: s.at })
        } else {
          updates.push(prisma.opsOrder.update({ where: { id: prev.id }, data: { ...data, ...(prev.driverId ? {} : { driverId: bind }) } }))
          if (prev.status !== o.status) {
            const from = RANK[prev.status] ?? -1, to = RANK[o.status] ?? -1
            const stages = to > from ? stageEvents(o).filter(s => (RANK[s.status] ?? -1) > from && (RANK[s.status] ?? -1) <= to) : []
            if (stages.length) for (const s of stages) events.push({ orderId: prev.id, externalId: o.id, fromStatus: prev.status, toStatus: s.status, at: s.at })
            else events.push({ orderId: prev.id, externalId: o.id, fromStatus: prev.status, toStatus: o.status, at: new Date(o.updatedAt) })
          }
        }
      }

      if (toCreate.length) await prisma.opsOrder.createMany({ data: toCreate, skipDuplicates: true })
      for (let i = 0; i < updates.length; i += 50) await prisma.$transaction(updates.slice(i, i + 50))
      res.created += toCreate.length
      res.updated += updates.length

      if (events.length) {
        const needIds = events.filter(e => !e.orderId).map(e => e.externalId)
        const idMap = new Map<string, string>()
        if (needIds.length) {
          const rows = await prisma.opsOrder.findMany({ where: { source, externalId: { in: needIds } }, select: { id: true, externalId: true } })
          rows.forEach(x => idMap.set(x.externalId, x.id))
        }
        const rows = events.flatMap(e => {
          const orderId = e.orderId ?? idMap.get(e.externalId)
          return orderId ? [{ orderId, fromStatus: e.fromStatus, toStatus: e.toStatus, at: e.at, source: 'sync' }] : []
        })
        for (let i = 0; i < rows.length; i += 1000) await prisma.opsOrderEvent.createMany({ data: rows.slice(i, i + 1000) })
        res.events += rows.length
      }

      cursor = body.nextCursor ?? cursor
      if (!body.hasMore) break
    }

    res.ok = true
    res.cursor = cursor
    res.durationMs = Date.now() - t0
    await prisma.opsSyncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), fetched: res.fetched, created: res.created, updated: res.updated, events: res.events, cursorAfter: cursor, ok: true } })
    return res
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e)
    res.durationMs = Date.now() - t0
    await prisma.opsSyncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), fetched: res.fetched, created: res.created, updated: res.updated, events: res.events, ok: false, error: res.error } }).catch(() => {})
    return res
  } finally {
    running = false
  }
}
