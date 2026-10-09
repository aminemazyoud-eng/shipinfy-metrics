import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { dayOfTz, dayBoundsTz } from '@/lib/tz'
import { ACTIVE_SOURCE } from '@/lib/ops-data'
import { TERMINAL_STATUSES, DONE_STATUSES, isLate, isAtRisk } from '@/lib/ops-defs'
import { canonicalSlot } from '@/lib/ops-slots'

const DONE: string[] = [...DONE_STATUSES]
const TERMINAL: string[] = [...TERMINAL_STATUSES]
// Parcours d'une commande : À dispatcher (page Dispatch) → Assignée → Acceptée → En livraison  [= Suivi]  → Livrée (page Encaissement) → Encaissée (Historique)
const NOT_IN_SUIVI = ['READY_PICKUP', 'DELIVERED']

// GET /api/ops/orders?day=today&hub=&city=&status=&slot=09-12&late=1&q=&limit=400
// Suivi des commandes : statut, retard (minutes), livreur — + compteurs par statut pour les filtres.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const now = Date.now()
    const day = dayOfTz(sp.get('day'), now)
    const { from, to } = dayBoundsTz(day)
    const limit = Math.min(Number(sp.get('limit')) || 400, 1000)
    const hub = sp.get('hub'), city = sp.get('city'), status = sp.get('status'), slot = sp.get('slot'), q = sp.get('q')?.trim()

    // périmètre commun (source active, jour + reliquat ouvert, filtres) — les annulées n'y figurent jamais
    const scope: Prisma.OpsOrderWhereInput = {
      source: ACTIVE_SOURCE,
      OR: [{ slotStart: { gte: from, lt: to } }, { slotStart: { lt: from }, status: { notIn: TERMINAL } }],
      ...(hub ? { hubCode: hub } : {}), ...(city ? { city: city.toUpperCase() } : {}), ...(slot ? { slotLabel: slot } : {}),
      ...(q ? { AND: [{ OR: [{ reference: { contains: q } }, { externalId: { contains: q } }, { customerName: { contains: q, mode: 'insensitive' } }, { district: { contains: q, mode: 'insensitive' } }] }] } : {}),
    }
    const base: Prisma.OpsOrderWhereInput = { ...scope, NOT: { status: { in: [...NOT_IN_SUIVI, 'CANCELLED'] } } }
    const where: Prisma.OpsOrderWhereInput = {
      ...base, ...(status ? { status } : {}),
      ...(sp.get('late') === '1' ? { status: { notIn: [...TERMINAL, 'READY_PICKUP'] }, slotEnd: { lt: new Date(now) } } : {}),
    }

    const lateWhere: Prisma.OpsOrderWhereInput = { ...scope, status: { notIn: TERMINAL }, slotEnd: { lt: new Date(now) } }
    const [rows, counts, lateCount, lateUnassigned, toDispatch] = await Promise.all([
      prisma.opsOrder.findMany({
        where, orderBy: [{ slotEnd: 'asc' }, { externalId: 'asc' }], take: limit,
        select: { id: true, externalId: true, reference: true, hubCode: true, city: true, district: true, status: true, slotStart: true, slotEnd: true, slotLabel: true, amount: true, customerName: true,
          address: true, driverId: true, deliveredAt: true, noShowAt: true, attemptCount: true, driver: { select: { code: true, firstName: true, lastName: true } } },
      }),
      prisma.opsOrder.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      // retard = ouvert ET créneau dépassé, READY_PICKUP inclus (définition unique ops-defs) ; sous-total « dont non assignées »
      prisma.opsOrder.count({ where: lateWhere }),
      prisma.opsOrder.count({ where: { ...lateWhere, status: 'READY_PICKUP', driverId: null } }),
      prisma.opsOrder.count({ where: { source: ACTIVE_SOURCE, OR: base.OR, status: 'READY_PICKUP', ...(hub ? { hubCode: hub } : {}), ...(city ? { city: city.toUpperCase() } : {}) } }),
    ])

    return NextResponse.json({
      day, now: new Date(now).toISOString(),
      counts: Object.fromEntries(counts.map(c => [c.status, c._count._all])), late: lateCount, lateUnassigned, lateAssigned: lateCount - lateUnassigned, toDispatch,
      orders: rows.map(o => {
        const done = DONE.includes(o.status)
        const endedAt = o.deliveredAt ?? o.noShowAt
        const lateMin = done ? (endedAt && endedAt > o.slotEnd ? Math.round((endedAt.getTime() - o.slotEnd.getTime()) / 60_000) : 0)
          : o.slotEnd.getTime() < now ? Math.round((now - o.slotEnd.getTime()) / 60_000) : 0
        return {
          id: o.id, ref: o.reference || o.externalId, hubCode: o.hubCode, city: o.city, district: o.district, status: o.status, slotStart: o.slotStart, slotEnd: o.slotEnd, slotLabel: canonicalSlot(o.slotStart),
          amount: o.amount, customer: o.customerName, address: o.address, attempts: o.attemptCount, driver: o.driver ? { code: o.driver.code, name: `${o.driver.firstName} ${o.driver.lastName}` } : null,
          late: isLate(o, now), lateMin, deliveredLate: done && lateMin > 0,
          atRisk: isAtRisk(o, now), // définitions uniques (lib/ops-defs.ts)
        }
      }),
    })
  } catch (e) { return fail(e) }
}
