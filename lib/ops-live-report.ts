/**
 * lib/ops-live-report.ts — UNE seule base de données pour Performance ET Cockpit.
 *
 * Les pages Performance (Dashboard, KPIs, Livreurs, Hubs, Retours, Score IA, Prévisions) lisent des « rapports »
 * (DeliveryReport → DeliveryOrder, historiquement importés depuis Excel). Le Cockpit lit OpsOrder (back-office, synchro 5 min).
 * Pour que les deux voient exactement les mêmes commandes, on maintient un rapport spécial « LIVE » (id fixe) qui est
 * la COPIE de OpsOrder au format rapport. Il est daté « maintenant » : les pages, qui prennent le rapport le plus récent,
 * l'affichent par défaut. Les anciens imports Excel restent disponibles dans le sélecteur de rapport.
 * Rafraîchi à chaque synchro qui apporte des changements (toutes les 5 min).
 *
 * Sprint 17 B1 : ids STABLES `live-${externalId}` (plus de cuid régénérés à chaque synchro) et rafraîchissement DIFFÉRENTIEL :
 * on ne relit/réécrit que les commandes créées/modifiées, par lots de 500 (500 lignes × ~30 colonnes ≈ 15 000 paramètres,
 * sous la limite Postgres de 32 767 — ne jamais dépasser). Les lignes disparues ne sont supprimées que lors d'une reconstruction complète.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ACTIVE_SOURCE } from '@/lib/ops-data'

export const LIVE_REPORT_ID = 'live-ops'
export const LIVE_REPORT_NAME = 'LIVE — Back-office E-Delivery (temps réel)'

const CHUNK = 500
export const liveId = (externalId: string) => `live-${externalId}`

type Row = Prisma.OpsOrderGetPayload<{ include: { driver: { select: { code: true; firstName: true; lastName: true } } } }>
type Hub = { code: string; name: string; city: string | null; lat: number | null; lng: number | null }

function toLive(o: Row, hubBy: Map<string, Hub>): Prisma.DeliveryOrderCreateManyInput {
  const hub = o.hubCode ? hubBy.get(o.hubCode) : undefined
  const [first, ...rest] = (o.customerName ?? '').split(' ')
  return {
    id: liveId(o.externalId), reportId: LIVE_REPORT_ID,
    externalReference: o.externalId, shipperReference: o.reference ?? o.externalId, carrierReference: o.externalId,
    deliveryTimeStart: o.slotStart, deliveryTimeEnd: o.slotEnd,
    dateTimeWhenOrderSent: o.createdAtSrc, dateTimeWhenAssigned: o.assignedAt, dateTimeWhenInTransport: o.inTransportAt,
    dateTimeWhenStartDelivery: o.startDeliveryAt, dateTimeWhenDelivered: o.deliveredAt, dateTimeWhenNoShow: o.noShowAt, dateTimeLastUpdate: o.sourceUpdatedAt,
    shippingWorkflowStatus: o.status, paymentOnDeliveryAmount: o.amount,
    destinationFirstname: first || null, destinationLastname: rest.join(' ') || null, destinationCityCode: o.city,
    destinationLongitude: o.lng, destinationLatitude: o.lat,
    originHubName: hub?.name ?? o.hubCode, originHubCode: o.hubCode, originHubCity: hub?.city ?? o.city, originHubLongitude: hub?.lng ?? null, originHubLatitude: hub?.lat ?? null,
    sprintName: o.driver?.code ?? null, livreurFirstName: o.driver?.firstName ?? null, livreurLastName: o.driver?.lastName ?? null,
    sprintGeoLongitude: null, sprintGeoLatitude: null,
  }
}

/**
 * Recopie OpsOrder → rapport LIVE.
 *  - `changedExternalIds` fourni : mode DIFFÉRENTIEL (seules ces commandes sont relues et réécrites, ids inchangés) ;
 *  - absent : reconstruction COMPLÈTE (ids stables conservés, lignes disparues supprimées).
 * Retourne le nombre de lignes écrites et la durée (ms).
 */
export async function refreshLiveReport(changedExternalIds?: string[]): Promise<{ orders: number; ms: number; mode: 'diff' | 'full' }> {
  const t0 = Date.now()
  const diff = Array.isArray(changedExternalIds)
  if (diff && !changedExternalIds.length) return { orders: 0, ms: 0, mode: 'diff' }

  const hubs = await prisma.opsHub.findMany({ select: { code: true, name: true, city: true, lat: true, lng: true } })
  const hubBy = new Map(hubs.map(h => [h.code, h]))
  const include = { driver: { select: { code: true, firstName: true, lastName: true } } } as const

  const rows: Row[] = []
  if (diff) {
    const ids = [...new Set(changedExternalIds)]
    for (let i = 0; i < ids.length; i += CHUNK) {
      rows.push(...await prisma.opsOrder.findMany({ where: { source: ACTIVE_SOURCE, externalId: { in: ids.slice(i, i + CHUNK) } }, include }))
    }
  } else {
    rows.push(...await prisma.opsOrder.findMany({ where: { source: ACTIVE_SOURCE }, include }))
  }
  const data = rows.map(o => toLive(o, hubBy))

  await prisma.deliveryReport.upsert({
    where: { id: LIVE_REPORT_ID },
    update: { filename: LIVE_REPORT_NAME, uploadedAt: new Date(), isActive: true },
    create: { id: LIVE_REPORT_ID, filename: LIVE_REPORT_NAME, isActive: true },
  })

  // remplacement atomique : les pages ne voient jamais un rapport à moitié rempli
  const ops: Prisma.PrismaPromise<unknown>[] = []
  if (!diff) ops.push(prisma.deliveryOrder.deleteMany({ where: { reportId: LIVE_REPORT_ID } })) // lignes disparues : reconstruction complète uniquement
  for (let i = 0; i < data.length; i += CHUNK) {
    const c = data.slice(i, i + CHUNK)
    // « upsert » par lot = suppression des mêmes ids puis insertion dans la même transaction (ids identiques avant/après)
    // (par externalReference : élimine aussi d'anciennes lignes à id cuid d'avant la migration vers les ids stables)
    if (diff) ops.push(prisma.deliveryOrder.deleteMany({ where: { reportId: LIVE_REPORT_ID, externalReference: { in: c.map(r => r.externalReference as string) } } }))
    ops.push(prisma.deliveryOrder.createMany({ data: c, skipDuplicates: true }))
  }
  if (ops.length) await prisma.$transaction(ops)
  return { orders: data.length, ms: Date.now() - t0, mode: diff ? 'diff' : 'full' }
}
