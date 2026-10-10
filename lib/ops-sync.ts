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
 *  - un livreur affecté par NOTRE dispatch (driverId) n'est jamais écrasé par la source ;
 *  - (Sprint 17 B4) un statut n'est jamais rétrogradé par la source : la poussée est empilée dans OpsOutbox et rejouée ;
 *  - verrou persistant (OpsSyncRun non terminé < 10 min) en plus du drapeau mémoire ; commandes invalides mises en quarantaine (OpsSyncReject).
 */
import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canonicalSlot } from '@/lib/ops-slots'

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
  customerPhone?: string | null // optionnel (suivi client / OTP) ; absent = champ local conservé
  customerPhoneNumber?: string | null
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
  cancelReason?: string | null
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
  rejected: number
  liveRefreshMs: number | null
  cursor: string | null
  error?: string
  durationMs: number
}

import { fillChain } from '@/lib/ops-chain'
import { bumpOpsEpoch } from '@/lib/ops-cache'
const RANK: Record<string, number> = { READY_PICKUP: 0, ASSIGNED: 1, IN_TRANSPORT: 2, START_DELIVERY: 3, DELIVERED: 4, NO_SHOW: 4, CANCELLED: 5 }
const PAGE_SIZE = 1000
const MAX_PAGES = 30
const LOCK_MS = 10 * 60_000 // une synchro non terminée depuis moins de 10 min bloque les autres (2 conteneurs)
const OUTBOX_MAX_ATTEMPTS = 3
const OUTBOX_BACKOFF_MIN = [1, 5, 15]
const MAX_REJECTS_STORED = 200 // par page : on compte tout, on n'archive que les premiers
const d = (v?: string | null) => (v ? new Date(v) : null)

let running = false
// ids à recopier dans le rapport LIVE dont le rafraîchissement a échoué (rejoués à la synchro suivante) ; reconstruction complète au 1er passage du processus
let livePending = new Set<string>()
let liveFullDone = false

export const opsSyncConfig = () => ({
  url: (process.env.BACKOFFICE_API_URL || 'http://localhost:4010').replace(/\/$/, ''),
  key: process.env.BACKOFFICE_API_KEY || 'dev-key',
  source: process.env.OPS_SOURCE || 'mock',
})

/** Étapes franchies par une commande, avec l'horodatage source — sert à reconstruire l'historique. */
function stageEvents(o: BoOrder): { status: string; at: Date; inferred?: boolean }[] {
  const out: { status: string; at: Date }[] = []
  const push = (status: string, v?: string | null) => { if (v) out.push({ status, at: new Date(v) }) }
  push('READY_PICKUP', o.createdAt)
  push('ASSIGNED', o.assignedAt)
  push('IN_TRANSPORT', o.inTransportAt)
  push('START_DELIVERY', o.startDeliveryAt)
  push('DELIVERED', o.deliveredAt)
  push('NO_SHOW', o.noShowAt)
  return fillChain(out, o.status) // jamais d'étape sautée : les étapes absentes de la source sont reconstituées (estimées)
}

/** Validation d'une commande source : renvoie la raison du rejet, ou null si elle est exploitable. */
export function validateBoOrder(o: unknown): string | null {
  const x = o as Partial<BoOrder> | null
  if (!x || typeof x !== 'object') return 'enregistrement illisible'
  if (typeof x.id !== 'string' || !x.id.trim()) return 'id manquant'
  if (typeof x.status !== 'string' || !(x.status in RANK)) return `statut inconnu : ${String(x.status)}`
  const ss = Date.parse(String(x.slotStart)), se = Date.parse(String(x.slotEnd))
  if (Number.isNaN(ss) || Number.isNaN(se)) return 'créneau illisible (slotStart/slotEnd)'
  if (ss >= se) return 'slotStart >= slotEnd'
  if (Number.isNaN(Date.parse(String(x.updatedAt)))) return 'updatedAt invalide'
  for (const f of ['createdAt', 'assignedAt', 'inTransportAt', 'startDeliveryAt', 'deliveredAt', 'noShowAt'] as const) {
    const v = x[f]
    if (v != null && v !== '' && Number.isNaN(Date.parse(String(v)))) return `date invalide : ${f}`
  }
  return null
}

/** Quarantaine : les commandes invalides n'arrêtent jamais la page (best effort si la table n'existe pas encore). */
async function quarantine(source: string, items: { externalId: string | null; reason: string; payload: unknown }[]) {
  for (const it of items.slice(0, MAX_REJECTS_STORED)) {
    let payload = ''
    try { payload = JSON.stringify(it.payload).slice(0, 1000) } catch { payload = String(it.payload).slice(0, 1000) }
    try {
      await prisma.$executeRaw`INSERT INTO "OpsSyncReject" ("id","source","externalId","reason","payload") VALUES (${randomUUID()}, ${source}, ${it.externalId}, ${it.reason}, ${payload})`
    } catch (e) { console.warn('[ops-sync] quarantaine impossible:', e instanceof Error ? e.message : e); break }
  }
}

/** Verrou persistant : crée le OpsSyncRun seulement si aucune synchro de la même source n'est en cours (< 10 min). Retourne null si occupé. */
async function acquireRun(source: string): Promise<string | null> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'opssync:' + source}))` // sérialise le test + l'insertion entre conteneurs
    const cutoff = new Date(Date.now() - LOCK_MS)
    await tx.opsSyncRun.updateMany({ where: { source, finishedAt: null, startedAt: { lte: cutoff } }, data: { finishedAt: new Date(), ok: false, error: 'interrompue (verrou expiré)' } })
    const busy = await tx.opsSyncRun.findFirst({ where: { source, finishedAt: null, startedAt: { gt: cutoff } }, select: { id: true } })
    if (busy) return null
    return (await tx.opsSyncRun.create({ data: { source, startedAt: new Date() }, select: { id: true } })).id
  })
}

/** Empile une poussée « assign » à rejouer (une seule ligne en attente par commande). */
export async function enqueueAssign(items: { externalId: string; courierRef: string | null }[]) {
  if (!items.length) return
  try {
    const ids = items.map(i => i.externalId)
    const pending = await prisma.$queryRaw<{ externalId: string }[]>`SELECT "externalId" FROM "OpsOutbox" WHERE "doneAt" IS NULL AND "kind" = 'assign' AND "externalId" = ANY(${ids}::text[])`
    const have = new Set(pending.map(r => r.externalId))
    for (const it of items) {
      if (have.has(it.externalId)) continue
      await prisma.$executeRaw`INSERT INTO "OpsOutbox" ("id","kind","externalId","courierRef") VALUES (${randomUUID()}, 'assign', ${it.externalId}, ${it.courierRef})`
    }
  } catch (e) { console.warn('[ops-sync] OpsOutbox indisponible:', e instanceof Error ? e.message : e) }
}

/**
 * Rejoue les poussées vers le back-office (début de chaque synchro) : affectations (kind 'assign') et changements de statut
 * faits par l'application livreur (kind 'status', statut dans courierRef).
 * 3 tentatives (attempts++ / nextRetryAt = +1, +5, +15 min) puis abandon (doneAt posé, attempts = 3 → distinguable d'un succès).
 * Les statuts d'une même commande sont poussés DANS L'ORDRE, un par un (accepté avant en livraison) ; en cas d'échec on s'arrête pour cette commande.
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number; abandoned: number }> {
  const out = { sent: 0, failed: 0, abandoned: 0 }
  try {
    const rows = await prisma.$queryRaw<{ id: string; kind: string; externalId: string; courierRef: string | null; attempts: number }[]>`
      SELECT "id","kind","externalId","courierRef","attempts" FROM "OpsOutbox"
      WHERE "doneAt" IS NULL AND "kind" IN ('assign','status') AND "nextRetryAt" <= ${new Date()}
      ORDER BY "createdAt" ASC LIMIT 200`
    if (!rows.length) return out
    const { url, key, source } = opsSyncConfig()
    const assignRows = rows.filter(r => r.kind === 'assign')
    const statusRows = rows.filter(r => r.kind === 'status')
    // on pousse l'affectation ACTUELLE (le dispatcher a pu la changer depuis l'empilement)
    const cur = assignRows.length ? await prisma.opsOrder.findMany({ where: { source, externalId: { in: assignRows.map(r => r.externalId) } }, select: { externalId: true, courierRef: true } }) : []
    const curBy = new Map(cur.map(c => [c.externalId, c.courierRef]))
    // résultat d'une tentative : succès → doneAt ; échec → attempts++ avec délai croissant, abandon à la 3e
    const settle = async (r: { id: string; attempts: number }, ok: boolean) => {
      if (ok) { await prisma.$executeRaw`UPDATE "OpsOutbox" SET "doneAt" = ${new Date()} WHERE "id" = ${r.id}`; out.sent++; return }
      const attempts = r.attempts + 1
      if (attempts >= OUTBOX_MAX_ATTEMPTS) { await prisma.$executeRaw`UPDATE "OpsOutbox" SET "attempts" = ${attempts}, "doneAt" = ${new Date()} WHERE "id" = ${r.id}`; out.abandoned++; return }
      const next = new Date(Date.now() + (OUTBOX_BACKOFF_MIN[attempts - 1] ?? 15) * 60_000)
      await prisma.$executeRaw`UPDATE "OpsOutbox" SET "attempts" = ${attempts}, "nextRetryAt" = ${next} WHERE "id" = ${r.id}`
      out.failed++
    }
    const post = async (externalId: string, action: 'assign' | 'status', body: unknown): Promise<boolean> => {
      try {
        const res = await fetch(`${url}/api/v1/orders/${encodeURIComponent(externalId)}/${action}`, { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) })
        return res.ok
      } catch { return false /* back-office indisponible */ }
    }
    const byOrder = new Map<string, typeof statusRows>()
    for (const r of statusRows) (byOrder.get(r.externalId) ?? byOrder.set(r.externalId, []).get(r.externalId)!).push(r)
    await Promise.all([
      ...assignRows.map(async r => {
        const courierRef = curBy.has(r.externalId) ? curBy.get(r.externalId) ?? null : r.courierRef
        await settle(r, await post(r.externalId, 'assign', { courierRef }))
      }),
      ...[...byOrder.values()].map(async list => {
        for (const r of list) { // déjà triées par createdAt
          const ok = await post(r.externalId, 'status', { status: r.courierRef })
          await settle(r, ok)
          if (!ok) break // on ne pousse pas un statut ultérieur avant le précédent
        }
      }),
    ])
  } catch (e) { console.warn('[ops-sync] flushOutbox:', e instanceof Error ? e.message : e) }
  return out
}

export async function runOpsSync(opts: { full?: boolean } = {}): Promise<OpsSyncResult> {
  const { url, key, source } = opsSyncConfig()
  const t0 = Date.now()
  const res: OpsSyncResult = { ok: false, source, fetched: 0, created: 0, updated: 0, events: 0, pages: 0, rejected: 0, liveRefreshMs: null, cursor: null, durationMs: 0 }
  if (running) return { ...res, error: 'sync déjà en cours', durationMs: 0 }
  running = true

  let runId: string | null = null
  try {
    // verrou persistant (le drapeau mémoire ne protège pas deux conteneurs) ; si la base est indisponible, l'erreur est rattrapée ci-dessous
    runId = await acquireRun(source)
    if (!runId) { res.error = 'sync déjà en cours (autre instance)'; res.durationMs = Date.now() - t0; return res }

    await flushOutbox() // rejoue d'abord les poussées d'affectation en attente

    const last = opts.full ? null : await prisma.opsSyncRun.findFirst({ where: { source, ok: true, cursorAfter: { not: null } }, orderBy: { startedAt: 'desc' } })
    let cursor: string | null = last?.cursorAfter ?? null
    const drivers = await prisma.opsDriver.findMany({ select: { id: true, code: true } })
    const driverByCode = new Map(drivers.map(x => [x.code, x.id]))
    const changed = new Set<string>() // externalId créés / modifiés → rafraîchissement différentiel du rapport LIVE

    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (cursor) qs.set('cursor', cursor)
      const r = await fetch(`${url}/api/v1/orders?${qs}`, { headers: { 'x-api-key': key }, cache: 'no-store', signal: AbortSignal.timeout(30_000) })
      if (!r.ok) throw new Error(`back-office HTTP ${r.status}`)
      const body = (await r.json()) as { data: BoOrder[]; hasMore: boolean; nextCursor: string | null }
      res.pages++
      if (!body.data.length) break
      res.fetched += body.data.length

      // validation : les lignes invalides vont en quarantaine, les autres passent
      const valid: BoOrder[] = []
      const rejects: { externalId: string | null; reason: string; payload: unknown }[] = []
      for (const o of body.data) {
        const why = validateBoOrder(o)
        if (why) rejects.push({ externalId: typeof (o as BoOrder)?.id === 'string' ? o.id : null, reason: why, payload: o })
        else valid.push(o)
      }
      if (rejects.length) { res.rejected += rejects.length; await quarantine(source, rejects) }

      if (valid.length) {
        const existing = await prisma.opsOrder.findMany({
          where: { source, externalId: { in: valid.map(o => o.id) } },
          select: { id: true, externalId: true, status: true, driverId: true, courierRef: true, driver: { select: { code: true } } },
        })
        const byExt = new Map(existing.map(e => [e.externalId, e]))

        const toCreate: Prisma.OpsOrderCreateManyInput[] = []
        const updates: ReturnType<typeof prisma.opsOrder.update>[] = []
        const outbox: { externalId: string; courierRef: string | null }[] = []
        const events: { orderId?: string; externalId: string; fromStatus: string | null; toStatus: string; at: Date; inferred?: boolean }[] = []

        for (const o of valid) {
          const data = {
            reference: o.reference ?? null, shipper: o.shipper ?? null, hubCode: o.hubCode ?? null, city: o.city ?? null, district: o.district ?? null,
            status: o.status, slotStart: new Date(o.slotStart), slotEnd: new Date(o.slotEnd), slotLabel: canonicalSlot(o.slotStart),
            ...((o.customerPhone ?? o.customerPhoneNumber) ? { customerPhone: String(o.customerPhone ?? o.customerPhoneNumber).slice(0, 32) } : {}),
            amount: o.amount ?? null, customerName: o.customerName ?? null, address: o.address ?? null, lat: o.lat ?? null, lng: o.lng ?? null,
            cluster: o.cluster ?? null, attemptCount: o.attemptCount ?? 1, courierRef: o.courierRef ?? null,
            createdAtSrc: d(o.createdAt), assignedAt: d(o.assignedAt), inTransportAt: d(o.inTransportAt), startDeliveryAt: d(o.startDeliveryAt),
            deliveredAt: d(o.deliveredAt), noShowAt: d(o.noShowAt), cancelReason: o.status === 'CANCELLED' ? (o.cancelReason ?? null) : null,
            sourceUpdatedAt: new Date(o.updatedAt), syncedAt: new Date(),
          }
          const prev = byExt.get(o.id)
          const bind = o.courierRef ? driverByCode.get(o.courierRef) ?? null : null
          if (!prev) {
            toCreate.push({ source, externalId: o.id, ...data, driverId: bind })
            const st = stageEvents(o)
            for (const s of st) events.push({ externalId: o.id, fromStatus: null, toStatus: s.status, at: s.at, inferred: s.inferred })
            if (!st.length && o.status === 'CANCELLED') events.push({ externalId: o.id, fromStatus: null, toStatus: 'CANCELLED', at: new Date(o.updatedAt) })
            changed.add(o.id)
          } else {
            const from = RANK[prev.status] ?? -1, to = RANK[o.status] ?? -1
            // JAMAIS de rétrogradation : la source est en retard sur notre dispatch → on garde statut / assignation locaux et on rejoue la poussée
            if (prev.driverId && to < from) {
              // la source est en retard : on ne touche NI au statut NI aux horodatages d'étape (posés par l'application livreur ou le dispatch)
              const { status: _s, courierRef: _c, assignedAt: _a, inTransportAt: _i, startDeliveryAt: _st, deliveredAt: _d, noShowAt: _n, ...rest } = data
              void _s; void _c; void _a; void _i; void _st; void _d; void _n
              updates.push(prisma.opsOrder.update({ where: { id: prev.id }, data: rest }))
              if (from >= RANK.ASSIGNED && from <= RANK.START_DELIVERY) outbox.push({ externalId: o.id, courierRef: prev.courierRef ?? prev.driver?.code ?? null })
              changed.add(o.id)
              continue
            }
            // la source ne doit jamais EFFACER un horodatage déjà posé localement (une valeur vide côté source n'écrase rien)
            const upd: Record<string, unknown> = { ...data, ...(prev.driverId ? {} : { driverId: bind }) }
            for (const k of ['assignedAt', 'inTransportAt', 'startDeliveryAt', 'deliveredAt', 'noShowAt']) if (upd[k] == null) delete upd[k]
            updates.push(prisma.opsOrder.update({ where: { id: prev.id }, data: upd as typeof data }))
            changed.add(o.id)
            if (prev.status !== o.status) {
              const stages = to > from ? stageEvents(o).filter(s => (RANK[s.status] ?? -1) > from && (RANK[s.status] ?? -1) <= to) : []
              if (stages.length) for (const s of stages) events.push({ orderId: prev.id, externalId: o.id, fromStatus: prev.status, toStatus: s.status, at: s.at, inferred: s.inferred })
              else events.push({ orderId: prev.id, externalId: o.id, fromStatus: prev.status, toStatus: o.status, at: new Date(o.updatedAt) })
            }
          }
        }

        if (toCreate.length) await prisma.opsOrder.createMany({ data: toCreate, skipDuplicates: true })
        for (let i = 0; i < updates.length; i += 50) await prisma.$transaction(updates.slice(i, i + 50))
        res.created += toCreate.length
        res.updated += updates.length
        await enqueueAssign(outbox)

        if (events.length) {
          const needIds = events.filter(e => !e.orderId).map(e => e.externalId)
          const idMap = new Map<string, string>()
          if (needIds.length) {
            const rows = await prisma.opsOrder.findMany({ where: { source, externalId: { in: needIds } }, select: { id: true, externalId: true } })
            rows.forEach(x => idMap.set(x.externalId, x.id))
          }
          const rows = events.flatMap(e => {
            const orderId = e.orderId ?? idMap.get(e.externalId)
            return orderId ? [{ orderId, fromStatus: e.fromStatus, toStatus: e.toStatus, at: e.at, source: e.inferred ? 'inferred' : 'sync' }] : []
          })
          // l'index unique (orderId, toStatus, at) + skipDuplicates rendent le rejeu idempotent
          for (let i = 0; i < rows.length; i += 1000) await prisma.opsOrderEvent.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true })
          res.events += rows.length
        }
      }

      cursor = body.nextCursor ?? cursor
      if (!body.hasMore) break
    }

    // Performance et Cockpit lisent la même donnée : on recopie OpsOrder dans le rapport LIVE (différentiel ; complet au 1er passage du processus ou en synchro « full »)
    const ids = [...changed, ...livePending]
    if (ids.length > 0 || !liveFullDone) {
      try {
        const { refreshLiveReport } = await import('@/lib/ops-live-report')
        const full = opts.full || !liveFullDone
        const lr = await (full ? refreshLiveReport() : refreshLiveReport(ids))
        res.liveRefreshMs = lr.ms
        liveFullDone = true
        livePending = new Set()
      } catch (e) {
        ids.forEach(i => livePending.add(i))
        console.warn('[ops-sync] rapport LIVE non rafraîchi:', e)
      }
    }
    // Agent C : secteur des commandes créées / modifiées (repli quartier si pas de GPS) puis ETA des tournées du jour. JAMAIS bloquant.
    try {
      if (changed.size) {
        const { tagSectorsForExternal } = await import('@/lib/ops-sectors')
        await tagSectorsForExternal(source, [...changed])
        void import('@/lib/ops-tours').then(m => m.recomputeEtaForDay()).catch(() => {})
      }
    } catch (e) { console.warn('[ops-sync] secteurs / ETA ignorés:', e instanceof Error ? e.message : e) }
    bumpOpsEpoch() // les vues en cache (prévisions, etc.) doivent refléter la synchro
    res.ok = true
    res.cursor = cursor
    res.durationMs = Date.now() - t0
    await prisma.opsSyncRun.update({ where: { id: runId }, data: { finishedAt: new Date(), fetched: res.fetched, created: res.created, updated: res.updated, events: res.events, cursorAfter: cursor, ok: true, durationMs: res.durationMs, liveRefreshMs: res.liveRefreshMs, pages: res.pages, rejected: res.rejected } })
    return res
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e)
    res.durationMs = Date.now() - t0
    if (runId) await prisma.opsSyncRun.update({ where: { id: runId }, data: { finishedAt: new Date(), fetched: res.fetched, created: res.created, updated: res.updated, events: res.events, ok: false, error: res.error, durationMs: res.durationMs, liveRefreshMs: res.liveRefreshMs, pages: res.pages, rejected: res.rejected } }).catch(() => {})
    return res
  } finally {
    running = false
  }
}
