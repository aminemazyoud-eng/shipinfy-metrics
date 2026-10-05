/**
 * lib/ops-live-report.ts — UNE seule base de données pour Performance ET Cockpit.
 *
 * Les pages Performance (Dashboard, KPIs, Livreurs, Hubs, Retours, Score IA, Prévisions) lisent des « rapports »
 * (DeliveryReport → DeliveryOrder, historiquement importés depuis Excel). Le Cockpit lit OpsOrder (back-office, synchro 5 min).
 * Pour que les deux voient exactement les mêmes commandes, on maintient un rapport spécial « LIVE » (id fixe) qui est
 * la COPIE de OpsOrder au format rapport. Il est daté « maintenant » : les pages, qui prennent le rapport le plus récent,
 * l'affichent par défaut. Les anciens imports Excel restent disponibles dans le sélecteur de rapport.
 * Rafraîchi à chaque synchro qui apporte des changements (toutes les 5 min).
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const LIVE_REPORT_ID = 'live-ops'
export const LIVE_REPORT_NAME = 'LIVE — Back-office E-Delivery (temps réel)'

export async function refreshLiveReport(): Promise<{ orders: number; ms: number }> {
  const t0 = Date.now()
  const [rows, hubs] = await Promise.all([
    prisma.opsOrder.findMany({ include: { driver: { select: { code: true, firstName: true, lastName: true } } } }),
    prisma.opsHub.findMany({ select: { code: true, name: true, city: true, lat: true, lng: true } }),
  ])
  const hubBy = new Map(hubs.map(h => [h.code, h]))

  const data: Prisma.DeliveryOrderCreateManyInput[] = rows.map(o => {
    const hub = o.hubCode ? hubBy.get(o.hubCode) : undefined
    const [first, ...rest] = (o.customerName ?? '').split(' ')
    return {
      reportId: LIVE_REPORT_ID,
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
  })

  await prisma.deliveryReport.upsert({
    where: { id: LIVE_REPORT_ID },
    update: { filename: LIVE_REPORT_NAME, uploadedAt: new Date(), isActive: true },
    create: { id: LIVE_REPORT_ID, filename: LIVE_REPORT_NAME, isActive: true },
  })
  // remplacement atomique : les pages ne voient jamais un rapport à moitié rempli
  const chunks: Prisma.DeliveryOrderCreateManyInput[][] = []
  for (let i = 0; i < data.length; i += 500) chunks.push(data.slice(i, i + 500))
  await prisma.$transaction([
    prisma.deliveryOrder.deleteMany({ where: { reportId: LIVE_REPORT_ID } }),
    ...chunks.map(c => prisma.deliveryOrder.createMany({ data: c })),
  ])
  return { orders: data.length, ms: Date.now() - t0 }
}
