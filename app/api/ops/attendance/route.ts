import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { dayOf, dayBounds, attendanceKey } from '@/lib/ops-time'

const STATUSES = ['present', 'late', 'absent', 'leave']

// GET /api/ops/attendance?day=today — pointage de la journée (un par livreur) + commandes livrées ce jour
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const day = dayOf(new URL(req.url).searchParams.get('day'))
    const { from, to } = dayBounds(day)
    const [drivers, att, delivered] = await Promise.all([
      prisma.opsDriver.findMany({ where: { status: { not: 'off' } }, include: { hub: { select: { code: true, name: true } } }, orderBy: [{ hubId: 'asc' }, { code: 'asc' }] }),
      prisma.opsAttendance.findMany({ where: { date: attendanceKey(day) } }),
      prisma.opsOrder.groupBy({ by: ['driverId'], where: { driverId: { not: null }, status: 'DELIVERED', deliveredAt: { gte: from, lt: to } }, _count: { _all: true } }),
    ])
    const a = new Map(att.map(x => [x.driverId, x])); const dl = new Map(delivered.map(x => [x.driverId as string, x._count._all]))
    return NextResponse.json({
      day,
      drivers: drivers.map(d => ({ code: d.code, name: `${d.firstName} ${d.lastName}`, hubCode: d.hub?.code ?? null, hubName: d.hub?.name ?? null, dailyRate: d.dailyRate,
        status: a.get(d.id)?.status ?? null, checkIn: a.get(d.id)?.checkIn ?? null, checkOut: a.get(d.id)?.checkOut ?? null, notes: a.get(d.id)?.notes ?? null, delivered: dl.get(d.id) ?? 0 })),
    })
  } catch (e) { return fail(e) }
}

// POST /api/ops/attendance { day?, driverCode, status, checkIn?: "now"|ISO, checkOut?: "now"|ISO, notes? }
//   ou { day?, all: true, status: "present", hubCode? }  → pointe en bloc tous les livreurs non encore pointés
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as { day?: string; driverCode?: string; status?: string; checkIn?: string; checkOut?: string; notes?: string; all?: boolean; hubCode?: string }
    const day = dayOf(b.day); const date = attendanceKey(day); const now = new Date()
    if (b.status && !STATUSES.includes(b.status)) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    const t = (v?: string) => (v === 'now' ? now : v ? new Date(v) : undefined)

    if (b.all) {
      const drivers = await prisma.opsDriver.findMany({ where: { status: 'active', ...(b.hubCode ? { hub: { code: b.hubCode } } : {}) }, include: { hub: { select: { code: true } } } })
      const done = new Set((await prisma.opsAttendance.findMany({ where: { date }, select: { driverId: true } })).map(x => x.driverId))
      const todo = drivers.filter(d => !done.has(d.id))
      if (todo.length) await prisma.opsAttendance.createMany({ data: todo.map(d => ({ driverId: d.id, date, status: b.status || 'present', hubCode: d.hub?.code ?? null, checkIn: (b.status || 'present') === 'present' ? now : null })) })
      await audit(auth.session, 'attendance.bulk', 'attendance', day, { count: todo.length, status: b.status || 'present' }, b.hubCode)
      return NextResponse.json({ ok: true, created: todo.length })
    }

    if (!b.driverCode) return NextResponse.json({ error: 'driverCode requis' }, { status: 400 })
    const driver = await prisma.opsDriver.findUnique({ where: { code: b.driverCode }, include: { hub: { select: { code: true } } } })
    if (!driver) return NextResponse.json({ error: 'Livreur inconnu' }, { status: 404 })
    const data = {
      ...(b.status ? { status: b.status } : {}), ...(b.checkIn !== undefined ? { checkIn: t(b.checkIn) } : {}), ...(b.checkOut !== undefined ? { checkOut: t(b.checkOut) } : {}),
      ...(b.notes !== undefined ? { notes: b.notes } : {}),
    }
    const rec = await prisma.opsAttendance.upsert({
      where: { driverId_date: { driverId: driver.id, date } }, update: data,
      create: { driverId: driver.id, date, status: b.status || 'present', hubCode: driver.hub?.code ?? null, checkIn: b.checkIn !== undefined ? t(b.checkIn) : (b.status || 'present') === 'present' ? now : null, checkOut: t(b.checkOut), notes: b.notes ?? null },
    })
    await audit(auth.session, 'attendance.set', 'attendance', driver.code, { day, status: rec.status }, driver.hub?.code)
    return NextResponse.json({ ok: true, status: rec.status })
  } catch (e) { return fail(e) }
}
