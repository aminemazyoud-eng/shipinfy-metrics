import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { driverAppConfig, shortName } from '@/lib/ops-driver-actions'
import { lateMinutes } from '@/lib/ops-defs'
import { localToday, dayBoundsTz } from '@/lib/tz'

export const dynamic = 'force-dynamic'

const OPEN = ['ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY']

// GET /api/driver/orders — UNIQUEMENT les commandes assignées à ce livreur : reliquat non terminé + livrées / absences du jour.
export async function GET(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const { applyOpsSettings } = await import('@/lib/ops-settings')
    await applyOpsSettings()
    const now = Date.now()
    const { from, to } = dayBoundsTz(localToday(now))
    const rows = await prisma.opsOrder.findMany({
      where: {
        driverId: d.id,
        OR: [
          { status: { in: OPEN } },
          { status: 'DELIVERED', deliveredAt: { gte: from, lt: to } },
          { status: 'NO_SHOW', noShowAt: { gte: from, lt: to } },
        ],
      },
      orderBy: [{ slotStart: 'asc' }, { id: 'asc' }],
      take: 300,
      select: {
        id: true, reference: true, externalId: true, status: true, slotLabel: true, slotStart: true, slotEnd: true, customerName: true, district: true, address: true,
        lat: true, lng: true, amount: true, customerPhone: true, otpAttempts: true, otpVerifiedAt: true, arrivedAt: true, reasonCode: true,
      },
    })
    const withProof = new Set((rows.length
      ? await prisma.opsProof.groupBy({ by: ['orderId'], where: { orderId: { in: rows.map(r => r.id) } }, _count: { _all: true } })
      : []).map(p => p.orderId))
    const { otpRequired } = driverAppConfig()
    return driverJson({
      serverTime: new Date(now).toISOString(),
      orders: rows.map(o => ({
        id: o.id, ref: o.reference ?? o.externalId, status: o.status, slotLabel: o.slotLabel, slotStart: o.slotStart.toISOString(), slotEnd: o.slotEnd.toISOString(),
        customerName: shortName(o.customerName), district: o.district, address: o.address, lat: o.lat, lng: o.lng, amount: o.amount, customerPhone: o.customerPhone,
        otpRequired, otpVerified: o.otpVerifiedAt != null, otpAttempts: o.otpAttempts,
        lateMin: lateMinutes({ status: o.status, slotEnd: o.slotEnd }, now), hasProof: withProof.has(o.id),
        arrivedAt: o.arrivedAt?.toISOString() ?? null, reasonCode: o.reasonCode,
      })),
    })
  } catch (e) { console.error('[api/driver/orders]', e); return driverJson({ error: 'Erreur serveur' }, 500) }
}
