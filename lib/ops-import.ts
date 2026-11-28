/**
 * lib/ops-import.ts — SCÉNARIO B : alimenter le Dashboard par un FICHIER D'EXPORT Shipinfy (CSV / Excel), en plus de l'API du back-office (scénario A).
 * Fonctions pures (aucun accès base) : transforment les lignes d'un export (les 22 colonnes de l'export Shipinfy) en commandes `OpsOrder`
 * rangées sous la source « import » — donc lues par les mêmes écrans, avec les mêmes calculs que pour l'API.
 * La persistance est dans lib/ops-import-db.ts ; la lecture du fichier dans lib/xlsx-import.ts (taille/format contrôlés, worker isolé).
 */
import { parseDate } from '@/lib/ops-bi'

/** Source sous laquelle les commandes importées sont rangées (distincte de l'API : aucun mélange). */
export const IMPORT_SOURCE = 'import'
export const IMPORT_HUB_PREFIX = 'IMP:'

/** Les 22 colonnes de l'export Shipinfy (orthographe d'origine : « Delivrered », « lattitude »). */
export const EXPORT_COLUMNS = [
  'shipperReference', 'dateTimeWhenOrderSent', 'dateTimeWhenAssigned', 'dateTimeWhenInTransport', 'dateTimeWhenStartDelivery', 'dateTimeWhenDelivrered',
  'deliveryTimeStart', 'deliveryTimeEnd', 'deliveryAttemptCount', 'shippingWorkflowStatus', 'paymentOnDeliveryAmount', 'originHub.name',
  'originHub.address.longitude', 'originHub.address.lattitude', 'destinationShippingAddress.longitude', 'destinationShippingAddress.lattitude',
  'destinationContactDetails.mobileNumber', 'destinationContactDetails.firstname', 'sprint.businessUser.firstName', 'sprint.businessUser.lastName',
  'sprint.businessUser.id', 'dateTimeLastUpdate',
] as const
/** Colonnes sans lesquelles une ligne n'est pas exploitable. */
export const REQUIRED_COLUMNS = ['shipperReference', 'dateTimeWhenOrderSent', 'deliveryTimeStart', 'deliveryTimeEnd', 'shippingWorkflowStatus', 'originHub.name'] as const

/** Statuts connus de Metrics (les autres sont acceptés mais signalés). */
export const KNOWN_STATUSES = ['READY_PICKUP', 'ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY', 'DELIVERED', 'NO_SHOW', 'CANCELLED'] as const

export interface ImportedOrder {
  externalId: string; hubCode: string; status: string
  slotStart: Date; slotEnd: Date
  createdAtSrc: Date | null; assignedAt: Date | null; inTransportAt: Date | null; startDeliveryAt: Date | null; deliveredAt: Date | null; noShowAt: Date | null
  attemptCount: number; amount: number | null; lat: number | null; lng: number | null
  customerName: string | null; customerPhone: string | null; courierRef: string | null; sourceUpdatedAt: Date
}
export interface ImportedHub { code: string; name: string; lat: number | null; lng: number | null }
export interface ImportReject { line: number; reference: string | null; reason: string }
export interface ImportMapping {
  orders: ImportedOrder[]; hubs: ImportedHub[]; rejected: ImportReject[]
  rows: number; unique: number; duplicates: number
  period: { from: string; to: string } | null
  statuses: Record<string, number>; unknownStatuses: string[]
  missingColumns: string[]
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim())
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const date = (v: unknown): Date | null => { const t = parseDate(v instanceof Date ? v.toISOString() : v); return Number.isFinite(t) ? new Date(t) : null }
const validGps = (lon: number | null, lat: number | null) => lon !== null && lat !== null && lon !== 0 && lat !== 0 && Math.abs(lon) <= 180 && Math.abs(lat) <= 90

export function hubSlug(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'inconnu'
}
export function normalizeStatus(s: string): string {
  const u = s.trim().toUpperCase().replace(/\s+/g, '_')
  return u === 'CANCELED' ? 'CANCELLED' : u
}

/** Transforme les lignes d'un export (objets { en-tête: valeur }) en commandes prêtes à enregistrer. */
export function mapExportRows(raw: Record<string, unknown>[]): ImportMapping {
  const out: ImportMapping = { orders: [], hubs: [], rejected: [], rows: raw.length, unique: 0, duplicates: 0, period: null, statuses: {}, unknownStatuses: [], missingColumns: [] }
  const headers = new Set<string>(raw.flatMap(r => Object.keys(r).map(h => h.replace(/^﻿/, '').trim())))
  out.missingColumns = REQUIRED_COLUMNS.filter(c => !headers.has(c))
  if (out.missingColumns.length || !raw.length) return out

  // colonnes tolérées avec orthographe alternative
  const pick = (r: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k]; return undefined }
  const best = new Map<string, { o: ImportedOrder; line: number }>()
  const hubs = new Map<string, ImportedHub>()

  raw.forEach((r0, i) => {
    const r: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r0)) r[k.replace(/^﻿/, '').trim()] = v
    const line = i + 2 // ligne 1 = en-têtes
    const ref = str(r.shipperReference)
    if (!ref) return void out.rejected.push({ line, reference: null, reason: 'référence (shipperReference) absente' })
    const slotStart = date(r.deliveryTimeStart), slotEnd = date(r.deliveryTimeEnd)
    if (!slotStart || !slotEnd || slotEnd <= slotStart) return void out.rejected.push({ line, reference: ref, reason: 'créneau invalide (deliveryTimeStart / deliveryTimeEnd)' })
    const status = normalizeStatus(str(r.shippingWorkflowStatus))
    if (!status) return void out.rejected.push({ line, reference: ref, reason: 'statut (shippingWorkflowStatus) absent' })

    const created = date(r.dateTimeWhenOrderSent)
    const updated = date(r.dateTimeLastUpdate) ?? created ?? slotEnd
    const hubName = str(r['originHub.name']) || 'Non renseigné'
    const hubCode = IMPORT_HUB_PREFIX + hubSlug(hubName)
    const hlon = num(pick(r, 'originHub.address.longitude')), hlat = num(pick(r, 'originHub.address.lattitude', 'originHub.address.latitude'))
    const prev = hubs.get(hubCode)
    if (!prev) hubs.set(hubCode, { code: hubCode, name: hubName, lat: validGps(hlon, hlat) ? hlat : null, lng: validGps(hlon, hlat) ? hlon : null })
    else if (prev.lat === null && validGps(hlon, hlat)) { prev.lat = hlat; prev.lng = hlon }

    const lon = num(r['destinationShippingAddress.longitude']), lat = num(pick(r, 'destinationShippingAddress.lattitude', 'destinationShippingAddress.latitude'))
    const first = str(r['sprint.businessUser.firstName']), last = str(r['sprint.businessUser.lastName'])
    const phone = str(r['destinationContactDetails.mobileNumber']).replace(/\D/g, '')
    const attempt = num(r.deliveryAttemptCount)
    const o: ImportedOrder = {
      externalId: ref, hubCode, status, slotStart, slotEnd, createdAtSrc: created,
      assignedAt: date(r.dateTimeWhenAssigned), inTransportAt: date(r.dateTimeWhenInTransport), startDeliveryAt: date(r.dateTimeWhenStartDelivery),
      deliveredAt: date(pick(r, 'dateTimeWhenDelivrered', 'dateTimeWhenDelivered')), noShowAt: status === 'NO_SHOW' ? updated : null,
      attemptCount: attempt !== null && attempt >= 0 ? Math.round(attempt) : 1, amount: num(r.paymentOnDeliveryAmount),
      lat: validGps(lon, lat) ? lat : null, lng: validGps(lon, lat) ? lon : null,
      customerName: str(r['destinationContactDetails.firstname']) || null, customerPhone: phone || null,
      courierRef: `${first} ${last}`.trim() || str(r['sprint.businessUser.id']) || null, sourceUpdatedAt: updated,
    }
    const old = best.get(ref)
    if (old) out.duplicates++
    // l'export contient des lignes en double (une par produit) : on garde la plus récente
    if (!old || o.sourceUpdatedAt.getTime() >= old.o.sourceUpdatedAt.getTime()) best.set(ref, { o, line })
  })

  out.orders = [...best.values()].map(x => x.o)
  out.hubs = [...hubs.values()]
  out.unique = out.orders.length
  for (const o of out.orders) out.statuses[o.status] = (out.statuses[o.status] ?? 0) + 1
  out.unknownStatuses = Object.keys(out.statuses).filter(s => !(KNOWN_STATUSES as readonly string[]).includes(s))
  const days = out.orders.map(o => (o.createdAtSrc ?? o.slotStart).getTime()).sort((a, b) => a - b)
  if (days.length) out.period = { from: new Date(days[0]).toISOString().slice(0, 10), to: new Date(days.at(-1)!).toISOString().slice(0, 10) }
  return out
}

/** CSV modèle (en-têtes + 1 ligne d'exemple) pour préparer un fichier d'import. */
export function templateCsv(): string {
  const ex = ['CMD-0001', '2026-11-20T07:30:00.000+0000', '2026-11-20T08:00:00.000+0000', '2026-11-20T08:30:00.000+0000', '2026-11-20T09:00:00.000+0000', '2026-11-20T09:40:00.000+0000',
    '2026-11-20T08:00:00.000+0000', '2026-11-20T11:00:00.000+0000', '1', 'DELIVERED', '250', 'Marjane Marina', '-7.624387', '33.6071444', '-7.61', '33.59', '0612345678', 'Karim', 'Amine', 'B', 'D01', '2026-11-20T09:40:00.000+0000']
  return '﻿' + EXPORT_COLUMNS.join(',') + '\r\n' + ex.join(',') + '\r\n'
}

// ─────────────────────────── Mise à jour incrémentale (envoi automatique toutes les 5 minutes) ───────────────────────────
export interface ExistingLite {
  externalId: string; status: string; sourceUpdatedAt: Date; courierRef: string | null; attemptCount: number; amount: number | null
  assignedAt: Date | null; inTransportAt: Date | null; startDeliveryAt: Date | null; deliveredAt: Date | null
}
const t = (d: Date | null) => (d ? d.getTime() : null)

/** Vrai si la commande du fichier diffère de celle déjà enregistrée (horodatage de mise à jour plus récent OU contenu différent). */
export function orderChanged(old: ExistingLite, o: ImportedOrder): boolean {
  return o.sourceUpdatedAt.getTime() > old.sourceUpdatedAt.getTime() || o.status !== old.status || o.courierRef !== old.courierRef || o.attemptCount !== old.attemptCount ||
    o.amount !== old.amount || t(o.assignedAt) !== t(old.assignedAt) || t(o.inTransportAt) !== t(old.inTransportAt) || t(o.startDeliveryAt) !== t(old.startDeliveryAt) || t(o.deliveredAt) !== t(old.deliveredAt)
}

/** Sépare les commandes du fichier en : nouvelles, à mettre à jour, inchangées (on n'écrit que ce qui a bougé → un export complet toutes les 5 min reste léger). */
export function diffImport(existing: ExistingLite[], incoming: ImportedOrder[]): { toInsert: ImportedOrder[]; toReplace: ImportedOrder[]; unchanged: number } {
  const ex = new Map(existing.map(e => [e.externalId, e]))
  const toInsert: ImportedOrder[] = [], toReplace: ImportedOrder[] = []
  let unchanged = 0
  for (const o of incoming) {
    const old = ex.get(o.externalId)
    if (!old) toInsert.push(o)
    else if (orderChanged(old, o)) toReplace.push(o)
    else unchanged++
  }
  return { toInsert, toReplace, unchanged }
}
