/**
 * lib/ops-webhooks.ts — WEBHOOKS SORTANTS fiables : Shipinfy notifie les systèmes clients à chaque changement de statut.
 *
 * Source des événements : scrutation de OpsOrderEvent (aucun fichier métier modifié). Curseur = OpsCostParam 'webhook.cursor'
 * (ms, sur OpsOrderEvent.createdAt = heure d'insertion, car `at` est l'horodatage source et peut être ancien). Fenêtre de recouvrement
 * de 30 s contre les transactions qui valident en retard ; l'unicité (endpointId, dedupeKey = id de l'événement) rend le rejeu sans effet.
 * Un endpoint ne reçoit que les événements créés APRÈS sa création (pas de rattrapage d'historique).
 *
 * Livraison : POST JSON signé. En-têtes  x-shipinfy-signature = sha256=HMAC-SHA256(secret, `${timestamp}.${corps}`),
 * x-shipinfy-timestamp (secondes, à contrôler côté récepteur : fenêtre ±5 min = anti-rejeu), x-shipinfy-event, x-shipinfy-delivery (id, pour dédoublonner).
 * Relances : 8 tentatives au total, délais 1 min, 5 min, 15 min, 1 h, 3 h, 12 h, 24 h ; puis statut FAILED (rejeu manuel depuis /operations/integrations).
 * Secret : généré à la création, affiché UNE fois ; stocké CHIFFRÉ (AES-256-GCM, clé dérivée de WEBHOOK_SECRET_KEY) car l'HMAC exige le secret en clair à l'envoi.
 * Sortie HTTP : safeFetch (https, hôte dans OUTBOUND_ALLOWED_HOSTS, adresses privées refusées, pas de redirection).
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { requireEnv } from '@/lib/env'
import { assertSafeUrl, safeFetch } from '@/lib/safe-fetch'
import { appUrl } from '@/lib/ops-planning'

export const MAX_ATTEMPTS = 8
const RETRY_MIN = [1, 5, 15, 60, 180, 720, 1440] // délai avant la tentative n+1
const CURSOR_KEY = 'webhook.cursor'
const OVERLAP_MS = 30_000
const SAFETY_LAG_MS = 5_000
const SCAN_TAKE = 5000

export const EVENT_OF_STATUS: Record<string, string> = {
  READY_PICKUP: 'order.created', ASSIGNED: 'order.assigned', IN_TRANSPORT: 'order.accepted',
  START_DELIVERY: 'order.out_for_delivery', DELIVERED: 'order.delivered', NO_SHOW: 'order.failed', CANCELLED: 'order.cancelled',
}
export const WEBHOOK_EVENTS = [...Object.values(EVENT_OF_STATUS), 'ping']

// ── secret chiffré ────────────────────────────────────────────────────────────
const encKey = () => createHash('sha256').update(requireEnv('WEBHOOK_SECRET_KEY')).digest()
export const newSecret = (): string => 'whsec_' + randomBytes(24).toString('hex')
export function sealSecret(plain: string): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', encKey(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `enc1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}
export function openSecret(stored: string): string {
  const [v, iv, tag, ct] = stored.split(':')
  if (v !== 'enc1' || !iv || !tag || !ct) throw new Error('secret illisible')
  const d = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}
export const sign = (secret: string, ts: string, body: string): string => 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')

export const matchesEvent = (events: string, event: string): boolean =>
  events.split(',').map(s => s.trim()).filter(Boolean).some(p => p === '*' || p === event || (p.endsWith('.*') && event.startsWith(p.slice(0, -1))))

export function validateEvents(list: unknown): string | string[] {
  if (!Array.isArray(list) || !list.length || list.length > 20) return 'events : liste de 1 à 20 événements (ou ["*"])'
  const out: string[] = []
  for (const e of list) {
    if (typeof e !== 'string') return 'events : texte attendu'
    const t = e.trim()
    if (t !== '*' && !WEBHOOK_EVENTS.includes(t) && !/^order\.\*$/.test(t)) return `événement inconnu : ${t}`
    out.push(t)
  }
  return out
}

/** URL de destination : https + hôte autorisé (OUTBOUND_ALLOWED_HOSTS) + DNS public. Renvoie le message d'erreur ou null. */
export async function checkEndpointUrl(url: string): Promise<string | null> {
  if (typeof url !== 'string' || url.length > 500) return 'URL invalide'
  try { await assertSafeUrl(url); return null } catch (e) { return (e instanceof Error ? e.message : 'URL refusée') + ' — l\'hôte doit figurer dans OUTBOUND_ALLOWED_HOSTS' }
}

// ── construction des livraisons depuis les événements ────────────────────────
async function cursorGet(): Promise<number | null> {
  const r = await prisma.opsCostParam.findUnique({ where: { key: CURSOR_KEY } })
  return r ? r.value : null
}
const cursorSet = (v: number) => prisma.opsCostParam.upsert({ where: { key: CURSOR_KEY }, update: { value: v }, create: { key: CURSOR_KEY, value: v, note: 'Curseur webhooks sortants (ms, OpsOrderEvent.createdAt)' } })

export async function buildPayloads(events: { id: string; orderId: string; toStatus: string; at: Date }[]) {
  const orders = await prisma.opsOrder.findMany({
    where: { id: { in: [...new Set(events.map(e => e.orderId))] } },
    select: { id: true, externalId: true, reference: true, status: true, reasonCode: true, courierRef: true, tourId: true, driver: { select: { code: true } },
      deliveredLat: true, deliveredLng: true, deliveryDistanceM: true, deliveryGeoOk: true, amount: true, collectedAmount: true, collectionMethod: true, collectedAt: true },
  })
  const byId = new Map(orders.map(o => [o.id, o]))
  const reasonCodes = [...new Set(orders.map(o => o.reasonCode).filter((x): x is string => !!x))]
  const reasons = reasonCodes.length ? await prisma.opsReason.findMany({ where: { code: { in: reasonCodes } }, select: { code: true, label: true } }) : []
  const reasonLabel = new Map(reasons.map(r => [r.code, r.label]))
  const tourIds = [...new Set(orders.map(o => o.tourId).filter((x): x is string => !!x))]
  const tours = tourIds.length ? await prisma.opsTour.findMany({ where: { id: { in: tourIds } }, select: { id: true, day: true, rotation: true } }) : []
  const tourBy = new Map(tours.map(t => [t.id, t]))
  const proofs = await prisma.opsProof.findMany({ where: { orderId: { in: [...byId.keys()] }, kind: 'delivery' }, orderBy: { createdAt: 'desc' }, select: { id: true, orderId: true } }).catch(() => [])
  const proofBy = new Map<string, string>(); for (const p of proofs) if (!proofBy.has(p.orderId)) proofBy.set(p.orderId, p.id)

  return events.flatMap(e => {
    const o = byId.get(e.orderId)
    if (!o) return []
    const event = EVENT_OF_STATUS[e.toStatus]
    if (!event) return []
    const delivered = e.toStatus === 'DELIVERED'
    const payload = {
      event, orderId: o.id, reference: o.reference, externalId: o.externalId, status: e.toStatus, at: e.at.toISOString(),
      geo: delivered && o.deliveredLat != null && o.deliveredLng != null ? { lat: o.deliveredLat, lng: o.deliveredLng, distanceM: o.deliveryDistanceM, ok: o.deliveryGeoOk } : null,
      reasonCode: o.reasonCode, reasonLabel: o.reasonCode ? reasonLabel.get(o.reasonCode) ?? null : null,
      cod: o.collectedAt ? { amount: o.collectedAmount, method: o.collectionMethod, collectedAt: o.collectedAt.toISOString() } : null,
      // URL protégée par la session Shipinfy (pas de lien public) : à ouvrir depuis un compte bureau
      proofUrl: delivered && proofBy.has(o.id) ? `${appUrl()}/api/ops/proofs/${proofBy.get(o.id)}` : null,
      tour: o.tourId && tourBy.has(o.tourId) ? { id: o.tourId, day: tourBy.get(o.tourId)!.day, rotation: tourBy.get(o.tourId)!.rotation } : null,
      driver: o.driver?.code || o.courierRef ? { code: o.driver?.code ?? o.courierRef } : null,
    }
    return [{ eventId: e.id, createdFor: o.id, event, payload }]
  })
}

/** Crée les livraisons PENDING pour les nouveaux événements. Idempotent. */
export async function enqueueNewEvents(): Promise<{ scanned: number; queued: number }> {
  const out = { scanned: 0, queued: 0 }
  const now = Date.now()
  const endpoints = await prisma.opsWebhookEndpoint.findMany({ where: { active: true } })
  const stored = await cursorGet()
  const upper = new Date(now - SAFETY_LAG_MS)
  if (!endpoints.length) { await cursorSet(now - OVERLAP_MS); return out } // rien à livrer : on avance (pas de rattrapage à la création d'un endpoint)
  const start = stored ?? now - OVERLAP_MS // première exécution : pas d'historique
  const evs = await prisma.opsOrderEvent.findMany({
    where: { createdAt: { gte: new Date(start), lte: upper } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: SCAN_TAKE,
    select: { id: true, orderId: true, toStatus: true, at: true, createdAt: true },
  })
  out.scanned = evs.length
  const full = evs.length >= SCAN_TAKE
  if (evs.length) {
    const live = evs.filter(e => EVENT_OF_STATUS[e.toStatus])
    // écarte ce qui est déjà livré (recouvrement) avant de construire les payloads
    const existing = live.length ? await prisma.opsWebhookDelivery.findMany({ where: { dedupeKey: { in: live.map(e => e.id) } }, select: { endpointId: true, dedupeKey: true } }) : []
    const have = new Set(existing.map(x => `${x.endpointId}|${x.dedupeKey}`))
    const need = live.filter(e => endpoints.some(ep => e.createdAt >= ep.createdAt && !have.has(`${ep.id}|${e.id}`) && matchesEvent(ep.events, EVENT_OF_STATUS[e.toStatus])))
    if (need.length) {
      const built = await buildPayloads(need)
      const rows = built.flatMap(b => {
        const ev = need.find(n => n.id === b.eventId)!
        return endpoints.filter(ep => ev.createdAt >= ep.createdAt && !have.has(`${ep.id}|${b.eventId}`) && matchesEvent(ep.events, b.event))
          .map(ep => ({ endpointId: ep.id, event: b.event, dedupeKey: b.eventId, payload: JSON.stringify(b.payload) }))
      })
      if (rows.length) out.queued = (await prisma.opsWebhookDelivery.createMany({ data: rows, skipDuplicates: true })).count
    }
  }
  const last = evs.length ? evs[evs.length - 1].createdAt.getTime() : null
  await cursorSet(full && last != null ? (last > start ? last : start + 1) : upper.getTime() - OVERLAP_MS)
  return out
}

// ── envoi ─────────────────────────────────────────────────────────────────────
type Row = { id: string; endpointId: string; event: string; payload: string; attempts: number }

async function deliverOne(row: Row): Promise<'ok' | 'retry' | 'failed'> {
  let err: string | null = null
  try {
    const ep = await prisma.opsWebhookEndpoint.findUnique({ where: { id: row.endpointId } })
    if (!ep || !ep.active) err = 'endpoint supprimé ou désactivé'
    else {
      const secret = openSecret(ep.secret)
      const ts = String(Math.floor(Date.now() / 1000))
      const res = await safeFetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'User-Agent': 'Shipinfy-Webhooks/1',
          'x-shipinfy-event': row.event, 'x-shipinfy-delivery': row.id, 'x-shipinfy-timestamp': ts, 'x-shipinfy-signature': sign(secret, ts, row.payload),
        },
        body: row.payload,
      })
      if (res.status >= 200 && res.status < 300) { await prisma.opsWebhookDelivery.update({ where: { id: row.id }, data: { status: 'OK', deliveredAt: new Date(), lastError: null } }); return 'ok' }
      err = `HTTP ${res.status}`
    }
  } catch (e) { err = (e instanceof Error ? e.message : 'erreur réseau').slice(0, 200) }
  const attempts = row.attempts // déjà incrémenté à la réservation
  if (attempts >= MAX_ATTEMPTS) { await prisma.opsWebhookDelivery.update({ where: { id: row.id }, data: { status: 'FAILED', lastError: err } }); return 'failed' }
  await prisma.opsWebhookDelivery.update({ where: { id: row.id }, data: { status: 'PENDING', lastError: err, nextAt: new Date(Date.now() + (RETRY_MIN[attempts - 1] ?? 1440) * 60_000) } })
  return 'retry'
}

/** Envoie les livraisons échues. Réservation atomique (UPDATE … RETURNING) : deux conteneurs ne livrent jamais deux fois la même ligne. */
export async function processDeliveries(opts: { limit?: number; id?: string } = {}): Promise<{ ok: number; retry: number; failed: number }> {
  const out = { ok: 0, retry: 0, failed: 0 }
  const now = new Date()
  const rows = opts.id
    ? await prisma.$queryRaw<Row[]>`UPDATE "OpsWebhookDelivery" SET "attempts" = "attempts" + 1, "nextAt" = ${new Date(now.getTime() + 120_000)}
        WHERE "id" = ${opts.id} AND "status" = 'PENDING' AND "nextAt" <= ${now} RETURNING "id","endpointId","event","payload","attempts"`
    : await prisma.$queryRaw<Row[]>`UPDATE "OpsWebhookDelivery" SET "attempts" = "attempts" + 1, "nextAt" = ${new Date(now.getTime() + 120_000)}
        WHERE "id" IN (SELECT "id" FROM "OpsWebhookDelivery" WHERE "status" = 'PENDING' AND "nextAt" <= ${now} ORDER BY "nextAt" ASC LIMIT ${opts.limit ?? 50} FOR UPDATE SKIP LOCKED)
        AND "status" = 'PENDING' RETURNING "id","endpointId","event","payload","attempts"`
  for (let i = 0; i < rows.length; i += 5) {
    const results = await Promise.all(rows.slice(i, i + 5).map(r => deliverOne(r).catch(() => 'retry' as const)))
    for (const r of results) out[r]++
  }
  return out
}

/** Tick du cron (1/min) : file puis envoi. Ne lève jamais. */
export async function webhookTick(): Promise<void> {
  try {
    const q = await enqueueNewEvents()
    const d = await processDeliveries({ limit: 100 })
    if (q.queued || d.ok || d.retry || d.failed) console.log(`[cron] webhooks: ${q.queued} en file, ${d.ok} envoyés, ${d.retry} à relancer, ${d.failed} échecs définitifs`)
  } catch (e) { console.warn('[cron] webhooks:', e instanceof Error ? e.message : e) }
}

/** Rejeu manuel : remet la livraison en file (compteur remis à zéro). */
export async function replayDelivery(id: string): Promise<boolean> {
  const n = await prisma.opsWebhookDelivery.updateMany({ where: { id, status: { in: ['FAILED', 'OK', 'PENDING'] } }, data: { status: 'PENDING', attempts: 0, nextAt: new Date(), lastError: null, deliveredAt: null } })
  return n.count > 0
}

/** Livraison de test « ping » vers un endpoint. */
export async function queuePing(endpointId: string): Promise<string> {
  const payload = JSON.stringify({ event: 'ping', at: new Date().toISOString(), message: 'Test de connexion Shipinfy' })
  const d = await prisma.opsWebhookDelivery.create({ data: { endpointId, event: 'ping', dedupeKey: `ping:${Date.now()}:${randomBytes(3).toString('hex')}`, payload } })
  return d.id
}
