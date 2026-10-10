/**
 * lib/ops-ingest.ts — API ENTRANTE : un système externe (e-commerce, WMS, back-office) POUSSE ses commandes dans Shipinfy.
 * Contrat : POST /api/v1/orders · PUT /api/v1/orders/:externalId · GET /api/v1/orders/:externalId (voir app/operations/integrations).
 *
 * Règles reprises de lib/ops-sync.ts :
 *  - idempotent sur (source, externalId) (contrainte unique + relecture en cas de course) ;
 *  - statut initial READY_PICKUP + OpsOrderEvent horodaté (index unique orderId,toStatus,at ⇒ rejeu sans doublon) ;
 *  - créneau officiel rattaché par canonicalSlot() (l'heure PROMISE slotStart/slotEnd n'est pas modifiée) ;
 *  - jamais de rétrogradation : l'API entrante ne peut ni changer un statut en cours de livraison ni modifier une commande terminée
 *    (seule exception : annulation « cancel: true » d'une commande non terminée) ;
 *  - la source des commandes est INGEST_SOURCE, à défaut la source active (OPS_ACTIVE_SOURCE) pour que la commande apparaisse au cockpit.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canonicalSlot } from '@/lib/ops-slots'
import { ACTIVE_SOURCE } from '@/lib/ops-data'
import { bumpOpsEpoch } from '@/lib/ops-cache'
import { dayStartUtc } from '@/lib/tz'

export const INGEST_MAX_BODY = 256 * 1024
export const INGEST_MAX_ITEMS = 200
export const ingestSource = (): string => (process.env.INGEST_SOURCE || ACTIVE_SOURCE).slice(0, 40)

export interface IngestItem { sku: string | null; label: string | null; qty: number; barcode: string | null; coldChain: boolean }
export interface IngestOrder {
  externalId: string
  reference: string | null
  slotStart: Date
  slotEnd: Date
  address: string | null
  district: string | null
  city: string | null
  lat: number | null
  lng: number | null
  customerName: string | null
  customerPhone: string | null
  amount: number | null
  hubCode: string | null
  shipper: string | null
  items: IngestItem[] | null // null = non fourni (PUT : ne pas toucher)
  cancel: boolean
  cancelReason: string | null
}

const TERMINAL = ['DELIVERED', 'NO_SHOW', 'CANCELLED']
const EXT_ID = /^[A-Za-z0-9._:-]{1,100}$/
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/g

const str = (v: unknown, max: number): string | null | undefined => {
  if (v == null || v === '') return null
  if (typeof v !== 'string') return undefined // type invalide
  const s = v.replace(CTRL, ' ').trim()
  return s.length > max ? undefined : (s || null)
}
const num = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined
}

function parseSlot(x: unknown): { start: Date; end: Date } | string {
  if (!x || typeof x !== 'object') return 'slot requis ({start,end} ISO 8601, ou {label:"09-12", date:"AAAA-MM-JJ"})'
  const s = x as Record<string, unknown>
  let start: number, end: number
  if (typeof s.start === 'string' && typeof s.end === 'string') {
    start = Date.parse(s.start); end = Date.parse(s.end)
    if (Number.isNaN(start) || Number.isNaN(end)) return 'slot.start / slot.end : date ISO 8601 invalide'
  } else if (typeof s.label === 'string' && typeof s.date === 'string') {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(s.label.trim())
    if (!m || !/^\d{4}-\d\d-\d\d$/.test(s.date) || Number.isNaN(Date.parse(s.date))) return 'slot.label (« 09-12 ») ou slot.date (AAAA-MM-JJ) invalide'
    const h1 = Number(m[1]), h2 = Number(m[2])
    if (h1 > 23 || h2 > 24 || h2 <= h1) return 'slot.label : heures incohérentes'
    const base = dayStartUtc(s.date) // minuit local Africa/Casablanca
    start = base + h1 * 3_600_000; end = base + h2 * 3_600_000
  } else return 'slot : fournir {start,end} ou {label,date}'
  if (end <= start) return 'slot : fin <= début'
  if (end - start > 24 * 3_600_000) return 'slot : fenêtre > 24 h'
  const now = Date.now()
  if (start < now - 120 * 86_400_000 || start > now + 120 * 86_400_000) return 'slot : début hors de ±120 jours'
  return { start: new Date(start), end: new Date(end) }
}

/** Validation stricte du corps JSON. `partial` (PUT) : slot facultatif aussi quand l'objet existe déjà. */
export function validateIngest(body: unknown, mode: 'create' | 'update', pathExternalId?: string): { value: IngestOrder } | { errors: string[] } {
  const errors: string[] = []
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: ['corps JSON objet attendu'] }
  const b = body as Record<string, unknown>
  const known = new Set(['externalId', 'reference', 'slot', 'address', 'district', 'city', 'lat', 'lng', 'customerName', 'customerPhone', 'amount', 'hubCode', 'shipper', 'items', 'cancel', 'cancelReason'])
  for (const k of Object.keys(b)) if (!known.has(k)) errors.push(`champ inconnu : ${k}`)

  const externalId = pathExternalId ?? (typeof b.externalId === 'string' ? b.externalId.trim() : '')
  if (!EXT_ID.test(externalId)) errors.push('externalId requis (1-100 caractères : lettres, chiffres, . _ : -)')
  if (pathExternalId && b.externalId != null && b.externalId !== pathExternalId) errors.push('externalId du corps différent de celui de l\'URL')

  const pick = <T,>(name: string, v: T | null | undefined, msg: string): T | null => { if (v === undefined) { errors.push(`${name} : ${msg}`); return null } return v }
  const reference = pick('reference', str(b.reference, 80), 'texte ≤ 80')
  const address = pick('address', str(b.address, 300), 'texte ≤ 300')
  const district = pick('district', str(b.district, 80), 'texte ≤ 80')
  const city = pick('city', str(b.city, 40), 'texte ≤ 40')
  const customerName = pick('customerName', str(b.customerName, 120), 'texte ≤ 120')
  const shipper = pick('shipper', str(b.shipper, 80), 'texte ≤ 80')
  const hubCode = pick('hubCode', str(b.hubCode, 40), 'texte ≤ 40')
  const cancelReason = pick('cancelReason', str(b.cancelReason, 200), 'texte ≤ 200')
  let customerPhone = pick('customerPhone', str(b.customerPhone, 32), 'texte ≤ 32')
  if (customerPhone && !/^[+\d][\d\s().-]{5,}$/.test(customerPhone)) { errors.push('customerPhone : numéro invalide'); customerPhone = null }
  const lat = pick('lat', num(b.lat, -90, 90), 'nombre entre -90 et 90')
  const lng = pick('lng', num(b.lng, -180, 180), 'nombre entre -180 et 180')
  if ((lat == null) !== (lng == null)) errors.push('lat et lng vont ensemble')
  const amount = pick('amount', num(b.amount, 0, 1_000_000), 'montant COD entre 0 et 1 000 000')
  if (b.cancel != null && typeof b.cancel !== 'boolean') errors.push('cancel : booléen')

  let slotStart = new Date(0), slotEnd = new Date(0)
  if (b.slot != null || mode === 'create') {
    const sl = parseSlot(b.slot)
    if (typeof sl === 'string') errors.push(sl); else { slotStart = sl.start; slotEnd = sl.end }
  }

  let items: IngestItem[] | null = null
  if (b.items != null) {
    if (!Array.isArray(b.items)) errors.push('items : tableau attendu')
    else if (b.items.length > INGEST_MAX_ITEMS) errors.push(`items : ${INGEST_MAX_ITEMS} lignes maximum`)
    else {
      items = []
      b.items.forEach((it, i) => {
        if (!it || typeof it !== 'object') { errors.push(`items[${i}] : objet attendu`); return }
        const r = it as Record<string, unknown>
        const sku = str(r.sku, 64), label = str(r.label, 200), barcode = str(r.barcode, 64)
        const qty = r.qty == null ? 1 : r.qty
        if (sku === undefined || label === undefined || barcode === undefined) { errors.push(`items[${i}] : sku/label/barcode invalides`); return }
        if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 10_000) { errors.push(`items[${i}].qty : entier 1-10000`); return }
        if (r.coldChain != null && typeof r.coldChain !== 'boolean') { errors.push(`items[${i}].coldChain : booléen`); return }
        if (!sku && !label && !barcode) { errors.push(`items[${i}] : sku, label ou barcode requis`); return }
        items!.push({ sku, label, qty, barcode, coldChain: r.coldChain === true })
      })
    }
  }
  if (errors.length) return { errors: errors.slice(0, 20) }
  return { value: { externalId, reference, slotStart, slotEnd, address, district, city, lat, lng, customerName, customerPhone, amount, hubCode, shipper, items, cancel: b.cancel === true, cancelReason } }
}

export type IngestResult =
  | { status: 200 | 201; created: boolean; order: Awaited<ReturnType<typeof getOrderView>> }
  | { status: 404 | 409 | 422; error: string }

async function refreshAfter(externalId: string) {
  bumpOpsEpoch()
  try { const { refreshLiveReport } = await import('@/lib/ops-live-report'); await refreshLiveReport([externalId]) } catch (e) { console.warn('[ingest] rapport LIVE non rafraîchi:', e instanceof Error ? e.message : e) }
}

/** Création idempotente (POST) ou création/mise à jour (PUT, `update=true`). */
export async function ingestOrder(v: IngestOrder, opts: { update: boolean; keyName: string }): Promise<IngestResult> {
  const source = ingestSource()
  let city = v.city
  if (v.hubCode) {
    const hub = await prisma.opsHub.findUnique({ where: { code: v.hubCode }, select: { city: true, active: true } })
    if (!hub || !hub.active) return { status: 422, error: `hubCode inconnu ou inactif : ${v.hubCode}` }
    city = city ?? hub.city
  }
  const existing = await prisma.opsOrder.findUnique({ where: { source_externalId: { source, externalId: v.externalId } }, select: { id: true, status: true } })

  if (existing) {
    if (!opts.update) return { status: 200, created: false, order: await getOrderView(source, v.externalId) } // POST rejoué : idempotent, aucun effet
    if (TERMINAL.includes(existing.status)) return { status: 409, error: `commande ${existing.status} : modification refusée` }
    if (v.cancel) {
      const now = new Date()
      await prisma.$transaction([
        prisma.opsOrder.update({ where: { id: existing.id }, data: { status: 'CANCELLED', cancelReason: v.cancelReason ?? 'Annulée par le système source', sourceUpdatedAt: now } }),
        prisma.opsOrderEvent.createMany({ data: [{ orderId: existing.id, fromStatus: existing.status, toStatus: 'CANCELLED', at: now, source: 'ingest' }], skipDuplicates: true }),
      ])
      await refreshAfter(v.externalId)
      return { status: 200, created: false, order: await getOrderView(source, v.externalId) }
    }
    if (v.items) {
      const loaded = await prisma.opsOrderItem.count({ where: { orderId: existing.id, loadedQty: { gt: 0 } } })
      if (loaded > 0) return { status: 409, error: 'chargement déjà commencé : les lignes ne peuvent plus être remplacées' }
    }
    const data: Prisma.OpsOrderUpdateInput = { sourceUpdatedAt: new Date() }
    const set = <K extends keyof Prisma.OpsOrderUpdateInput>(k: K, val: Prisma.OpsOrderUpdateInput[K] | undefined | null, given: boolean) => { if (given && val !== undefined) data[k] = val as never }
    // un champ absent du corps n'est pas touché ; un champ présent à null l'efface
    set('reference', v.reference, v.reference !== null); set('address', v.address, v.address !== null); set('district', v.district, v.district !== null)
    set('city', city, city !== null); set('customerName', v.customerName, v.customerName !== null); set('customerPhone', v.customerPhone, v.customerPhone !== null)
    set('shipper', v.shipper, v.shipper !== null); set('hubCode', v.hubCode, v.hubCode !== null); set('amount', v.amount, v.amount !== null)
    if (v.lat !== null && v.lng !== null) { data.lat = v.lat; data.lng = v.lng }
    if (v.slotEnd.getTime() > 0) { data.slotStart = v.slotStart; data.slotEnd = v.slotEnd; data.slotLabel = canonicalSlot(v.slotStart) }
    await prisma.$transaction(async tx => {
      await tx.opsOrder.update({ where: { id: existing.id }, data })
      if (v.items) { await tx.opsOrderItem.deleteMany({ where: { orderId: existing.id } }); if (v.items.length) await tx.opsOrderItem.createMany({ data: v.items.map(i => ({ orderId: existing.id, ...i })) }) }
    })
    await refreshAfter(v.externalId)
    return { status: 200, created: false, order: await getOrderView(source, v.externalId) }
  }

  if (v.slotEnd.getTime() <= 0) return { status: 422, error: 'slot requis pour créer la commande' }
  if (v.cancel) return { status: 422, error: 'cancel : commande inconnue' }
  const now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const o = await tx.opsOrder.create({
        data: {
          source, externalId: v.externalId, reference: v.reference, shipper: v.shipper ?? opts.keyName, hubCode: v.hubCode, city, district: v.district,
          status: 'READY_PICKUP', slotStart: v.slotStart, slotEnd: v.slotEnd, slotLabel: canonicalSlot(v.slotStart),
          amount: v.amount, customerName: v.customerName, customerPhone: v.customerPhone, address: v.address, lat: v.lat, lng: v.lng,
          attemptCount: 1, createdAtSrc: now, sourceUpdatedAt: now,
        },
        select: { id: true },
      })
      await tx.opsOrderEvent.createMany({ data: [{ orderId: o.id, fromStatus: null, toStatus: 'READY_PICKUP', at: now, source: 'ingest' }], skipDuplicates: true })
      if (v.items?.length) await tx.opsOrderItem.createMany({ data: v.items.map(i => ({ orderId: o.id, ...i })) })
    })
  } catch (e) {
    // course : un autre appel a créé la même commande entre-temps (contrainte unique) → comportement idempotent
    if ((e as { code?: string })?.code === 'P2002') return { status: 200, created: false, order: await getOrderView(source, v.externalId) }
    throw e
  }
  await refreshAfter(v.externalId)
  return { status: 201, created: true, order: await getOrderView(source, v.externalId) }
}

/** Relecture du statut (GET). */
export async function getOrderView(source: string, externalId: string) {
  const o = await prisma.opsOrder.findUnique({
    where: { source_externalId: { source, externalId } },
    include: { events: { orderBy: { at: 'asc' }, select: { toStatus: true, at: true } }, driver: { select: { code: true } } },
  })
  if (!o) return null
  const items = await prisma.opsOrderItem.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' }, select: { sku: true, label: true, qty: true, barcode: true, coldChain: true, loadedQty: true } })
  return {
    externalId: o.externalId, reference: o.reference, status: o.status,
    slot: { start: o.slotStart.toISOString(), end: o.slotEnd.toISOString(), label: o.slotLabel },
    hubCode: o.hubCode, city: o.city, district: o.district, address: o.address, amount: o.amount,
    driver: o.driver?.code ?? o.courierRef ?? null,
    timestamps: { assignedAt: o.assignedAt, inTransportAt: o.inTransportAt, startDeliveryAt: o.startDeliveryAt, deliveredAt: o.deliveredAt, noShowAt: o.noShowAt },
    reasonCode: o.reasonCode, cancelReason: o.cancelReason,
    delivery: o.deliveredAt ? { lat: o.deliveredLat, lng: o.deliveredLng, distanceM: o.deliveryDistanceM, geoOk: o.deliveryGeoOk } : null,
    cod: o.collectedAt ? { amount: o.collectedAmount, method: o.collectionMethod, collectedAt: o.collectedAt } : null,
    events: o.events.map(e => ({ status: e.toStatus, at: e.at })),
    items,
  }
}

/** Lit le corps JSON avec plafond de taille (Content-Length puis longueur réelle). */
export async function readJsonLimited(req: Request, max = INGEST_MAX_BODY): Promise<{ json: unknown } | { error: string; status: number }> {
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > max) return { error: `corps trop volumineux (max ${Math.round(max / 1024)} Ko)`, status: 413 }
  const text = await req.text()
  if (text.length > max) return { error: `corps trop volumineux (max ${Math.round(max / 1024)} Ko)`, status: 413 }
  try { return { json: JSON.parse(text) } } catch { return { error: 'JSON invalide', status: 400 } }
}
