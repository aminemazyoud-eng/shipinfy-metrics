import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { dayOf, dayBounds } from '@/lib/ops-time'
import { canonicalSlot } from '@/lib/ops-slots'

const DONE = ['DELIVERED', 'NO_SHOW']

// GET /api/ops/orders?day=today&hub=&city=&status=&slot=09-12&late=1&q=&limit=400
// Suivi des commandes : statut, retard (minutes), livreur — + compteurs par statut pour les filtres.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const now = Date.now()
    const day = dayOf(sp.get('day'), now)
    const { from, to } = dayBounds(day)
    const limit = Math.min(Number(sp.get('limit')) || 400, 1000)
    const hub = sp.get('hub'), city = sp.get('city'), status = sp.get('status'), slot = sp.get('slot'), q = sp.get('q')?.trim()

    const base: Prisma.OpsOrderWhereInput = {
      OR: [{ slotStart: { gte: from, lt: to } }, { slotStart: { lt: from }, status: { notIn: DONE } }],
      ...(hub ? { hubCode: hub } : {}), ...(city ? { city: city.toUpperCase() } : {}), ...(slot ? { slotLabel: slot } : {}),
      ...(q ? { AND: [{ OR: [{ reference: { contains: q } }, { externalId: { contains: q } }, { customerName: { contains: q, mode: 'insensitive' } }, { district: { contains: q, mode: 'insensitive' } }] }] } : {}),
    }
    const where: Prisma.OpsOrderWhereInput = {
      ...base, ...(status ? { status } : {}),
      ...(sp.get('late') === '1' ? { status: { notIn: DONE }, slotEnd: { lt: new Date(now) } } : {}),
    }

    const [rows, counts, lateCount] = await Promise.all([
      prisma.opsOrder.findMany({
        where, orderBy: [{ slotEnd: 'asc' }, { externalId: 'asc' }], take: limit,
        select: { id: true, externalId: true, reference: true, hubCode: true, city: true, district: true, status: true, slotStart: true, slotEnd: true, slotLabel: true, amount: true, customerName: true,
          address: true, deliveredAt: true, noShowAt: true, attemptCount: true, driver: { select: { code: true, firstName: true, lastName: true } } },
      }),
      prisma.opsOrder.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      prisma.opsOrder.count({ where: { ...base, status: { notIn: DONE }, slotEnd: { lt: new Date(now) } } }),
    ])

    return NextResponse.json({
      day, now: new Date(now).toISOString(),
      counts: Object.fromEntries(counts.map(c => [c.status, c._count._all])), late: lateCount,
      orders: rows.map(o => {
        const done = DONE.includes(o.status)
        const endedAt = o.deliveredAt ?? o.noShowAt
        const lateMin = done ? (endedAt && endedAt > o.slotEnd ? Math.round((endedAt.getTime() - o.slotEnd.getTime()) / 60_000) : 0)
          : o.slotEnd.getTime() < now ? Math.round((now - o.slotEnd.getTime()) / 60_000) : 0
        return {
          id: o.id, ref: o.reference || o.externalId, hubCode: o.hubCode, city: o.city, district: o.district, status: o.status, slotStart: o.slotStart, slotEnd: o.slotEnd, slotLabel: canonicalSlot(o.slotStart),
          amount: o.amount, customer: o.customerName, address: o.address, attempts: o.attemptCount, driver: o.driver ? { code: o.driver.code, name: `${o.driver.firstName} ${o.driver.lastName}` } : null,
          late: !done && o.slotEnd.getTime() < now, lateMin, deliveredLate: done && lateMin > 0,
          atRisk: !done && o.status !== 'START_DELIVERY' && o.slotEnd.getTime() >= now && o.slotEnd.getTime() - now < 45 * 60_000,
        }
      }),
    })
  } catch (e) { return fail(e) }
}
