import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { dayOf, dayBounds } from '@/lib/ops-time'
import { attendanceByName } from '@/lib/ops-attendance'
import { canonicalSlot } from '@/lib/ops-slots'
import { CFG } from '@/lib/ops-config'
import { drivingStatus } from '@/lib/rh'

const DONE = ['DELIVERED', 'NO_SHOW']

// GET /api/ops/dispatch?hub=CAS-MM&day=today
// Tout ce qu'il faut à l'écran de dispatch : commandes du hub (à dispatcher + en cours), livreurs (charge, présence), hubs.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const now = Date.now()
    const day = dayOf(sp.get('day'), now)
    const { from, to } = dayBounds(day)
    const hubs = await prisma.opsHub.findMany({ where: { active: true }, orderBy: { code: 'asc' } })
    // commandes à dispatcher par hub (badge sur chaque bouton hub) ; hub par défaut = celui qui en a le plus
    const pending = await prisma.opsOrder.groupBy({ by: ['hubCode'], _count: { _all: true }, where: { status: 'READY_PICKUP', driverId: null, OR: [{ slotStart: { gte: from, lt: to } }, { slotStart: { lt: from } }] } })
    const pendBy = new Map(pending.map(p => [p.hubCode, p._count._all]))
    const hubCode = sp.get('hub') || [...hubs].sort((a, b) => (pendBy.get(b.code) ?? 0) - (pendBy.get(a.code) ?? 0))[0]?.code
    if (!hubCode) return NextResponse.json({ hubs: [], orders: [], drivers: [], day })

    const [orders, drivers, att] = await Promise.all([
      prisma.opsOrder.findMany({
        where: { hubCode, OR: [{ slotStart: { gte: from, lt: to } }, { slotStart: { lt: from }, status: { notIn: DONE } }] },
        orderBy: [{ slotStart: 'asc' }, { externalId: 'asc' }],
        select: { id: true, externalId: true, reference: true, status: true, slotStart: true, slotEnd: true, slotLabel: true, district: true, amount: true, customerName: true, address: true, lat: true, lng: true, driverId: true },
      }),
      prisma.opsDriver.findMany({ where: { status: { not: 'off' }, jobType: 'chauffeur' }, include: { hub: { select: { code: true, name: true } }, vehicle: { select: { plate: true, type: true, crew: { where: { jobType: 'helper' }, select: { firstName: true, lastName: true } } } } }, orderBy: { code: 'asc' } }),
      attendanceByName(day),
    ])

    // charge des livreurs sur TOUT le jour (toutes commandes, tous hubs) pour ne pas surcharger un livreur « emprunté »
    const loads = await prisma.opsOrder.groupBy({
      by: ['driverId', 'status'], _count: { _all: true },
      where: { driverId: { not: null }, OR: [{ slotStart: { gte: from, lt: to } }, { slotStart: { lt: from }, status: { notIn: DONE } }] },
    })
    const lateRows = await prisma.opsOrder.groupBy({ by: ['driverId'], _count: { _all: true }, where: { driverId: { not: null }, status: { notIn: DONE }, slotEnd: { lt: new Date(now) } } })
    const lateBy = new Map(lateRows.map(l => [l.driverId as string, l._count._all]))
    const driverLoad = new Map<string, { active: number; done: number }>()
    for (const l of loads) {
      const d = driverLoad.get(l.driverId as string) ?? { active: 0, done: 0 }
      if (DONE.includes(l.status)) d.done += l._count._all; else d.active += l._count._all
      driverLoad.set(l.driverId as string, d)
    }
    const drvCode = new Map(drivers.map(d => [d.id, d.code]))

    return NextResponse.json({
      day, now: new Date(now).toISOString(), hubCode, hubs: hubs.map(h => ({ code: h.code, name: h.name, city: h.city, toDispatch: pendBy.get(h.code) ?? 0 })),
      orders: orders.map(o => ({
        id: o.id, ref: o.reference || o.externalId, status: o.status, slotStart: o.slotStart, slotEnd: o.slotEnd, slotLabel: canonicalSlot(o.slotStart), district: o.district,
        amount: o.amount, customer: o.customerName, address: o.address, lat: o.lat, lng: o.lng,
        driverCode: o.driverId ? drvCode.get(o.driverId) ?? null : null,
        late: !DONE.includes(o.status) && o.slotEnd.getTime() < now,
        atRisk: !DONE.includes(o.status) && o.status !== 'START_DELIVERY' && o.slotEnd.getTime() >= now && o.slotEnd.getTime() - now < CFG.atRiskMinutes * 60_000,
      })),
      drivers: drivers.map(d => ({
        code: d.code, driving: drivingStatus(d), name: `${d.firstName} ${d.lastName}`, hubCode: d.hub?.code ?? null, homeHubId: d.homeHubId, vehicle: d.vehicle?.type ?? null, plate: d.vehicle?.plate ?? null, helper: d.vehicle?.crew[0] ? `${d.vehicle.crew[0].firstName} ${d.vehicle.crew[0].lastName}` : null,
        attendance: att.get(`${d.firstName} ${d.lastName}`)?.status ?? null, active: driverLoad.get(d.id)?.active ?? 0, done: driverLoad.get(d.id)?.done ?? 0, late: lateBy.get(d.id) ?? 0,
      })),
    })
  } catch (e) { return fail(e) }
}
