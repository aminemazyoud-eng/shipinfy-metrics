import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { dayOf, dayBounds, attendanceKey } from '@/lib/ops-time'
import { attendanceByName, setAttendance, fullName, guardCorrection, isCorrection, snapshot, deriveFields } from '@/lib/ops-attendance'

const STATUSES = ['present', 'late', 'absent', 'leave']

// GET /api/ops/attendance?day=today — pointage de la journée = table RH (DriverAttendance) + commandes livrées ce jour
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const day = dayOf(new URL(req.url).searchParams.get('day'))
    const { from, to } = dayBounds(day)
    const [drivers, att, delivered] = await Promise.all([
      prisma.opsDriver.findMany({ where: { status: { not: 'off' } }, include: { hub: { select: { code: true, name: true } } }, orderBy: [{ hubId: 'asc' }, { code: 'asc' }] }),
      attendanceByName(day),
      prisma.opsOrder.groupBy({ by: ['driverId'], where: { driverId: { not: null }, status: 'DELIVERED', deliveredAt: { gte: from, lt: to } }, _count: { _all: true } }),
    ])
    const dl = new Map(delivered.map(x => [x.driverId as string, x._count._all]))
    return NextResponse.json({
      day, source: 'RH & Formation → Pointage',
      drivers: drivers.map(d => { const a = att.get(fullName(d)); return { code: d.code, name: fullName(d), hubCode: d.hub?.code ?? null, hubName: d.hub?.name ?? null, dailyRate: d.dailyRate,
        status: a?.status ?? null, checkIn: a?.checkIn ?? null, checkOut: a?.checkOut ?? null, notes: a?.notes ?? null, workedMinutes: a?.workedMinutes ?? null, lateMinutes: a?.lateMinutes ?? null, plannedDepart: a?.plannedDepart ?? null, delivered: dl.get(d.id) ?? 0 } }),
    })
  } catch (e) { return fail(e) }
}

// POST /api/ops/attendance { day?, driverCode, status, checkIn?: "now"|ISO, checkOut?: "now"|ISO, notes? }
//   ou { day?, all: true, status: "present", hubCode? }  → pointe en bloc les livreurs non encore pointés
// Écrit dans la table RH : le pointage reste unique, visible dans RH & Formation → Pointage.
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as { day?: string; driverCode?: string; status?: string; checkIn?: string; checkOut?: string; notes?: string; all?: boolean; hubCode?: string; reason?: string; override?: boolean }
    const day = dayOf(b.day); const now = new Date()
    if (b.status && !STATUSES.includes(b.status)) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    const t = (v?: string) => (v === 'now' ? now : v ? new Date(v) : undefined)

    // Verrou de période (paie validée) : 423 sauf ADMIN+ avec override + motif — journalisé
    if (b.all) {
      const g = await guardCorrection(auth.session, day, { needsReason: false, reason: b.reason, override: b.override })
      if (g.error) return g.error
      const drivers = await prisma.opsDriver.findMany({ where: { status: 'active', ...(b.hubCode ? { hub: { code: b.hubCode } } : {}) }, include: { hub: { select: { name: true } } } })
      const done = await attendanceByName(day)
      const todo = drivers.filter(d => !done.has(fullName(d)))
      const status = b.status || 'present'
      if (todo.length) {
        // Heures / retard / départ prévu calculés par livreur (statut 'present' → 'late' automatique si retard > tolérance)
        const data = await Promise.all(todo.map(async d => {
          const checkIn = status === 'present' ? now : null
          const f = await deriveFields(fullName(d), day, { checkIn, checkOut: null, status }, status !== 'present')
          return { driverName: fullName(d), date: attendanceKey(day), hub: d.hub?.name ?? null, status: f.status, role: 'LIVREUR', checkIn, workedMinutes: f.workedMinutes, lateMinutes: f.lateMinutes, plannedDepart: f.plannedDepart }
        }))
        await prisma.driverAttendance.createMany({ skipDuplicates: true, data })
      }
      await audit(auth.session, 'pointage.create', 'attendance', day, { bulk: true, day, count: todo.length, status, reason: g.reason, override: g.overridden }, b.hubCode)
      return NextResponse.json({ ok: true, created: todo.length })
    }

    if (!b.driverCode) return NextResponse.json({ error: 'driverCode requis' }, { status: 400 })
    const driver = await prisma.opsDriver.findUnique({ where: { code: b.driverCode }, include: { hub: { select: { code: true, name: true } } } })
    if (!driver) return NextResponse.json({ error: 'Livreur inconnu' }, { status: 404 })
    const patch = { ...(b.status ? { status: b.status } : {}), ...(b.checkIn !== undefined ? { checkIn: t(b.checkIn) ?? null } : {}), ...(b.checkOut !== undefined ? { checkOut: t(b.checkOut) ?? null } : {}), ...(b.notes !== undefined ? { notes: b.notes } : {}) }
    const existing = await prisma.driverAttendance.findUnique({ where: { driverName_date: { driverName: fullName(driver), date: attendanceKey(day) } } })
    const g = await guardCorrection(auth.session, day, { needsReason: isCorrection(existing, patch), reason: b.reason, override: b.override })
    if (g.error) return g.error
    const { rec, before } = await setAttendance(driver, driver.hub?.name ?? null, day, patch, { status: 'present', checkIn: (b.status || 'present') === 'present' ? now : null })
    await audit(auth.session, before ? 'pointage.update' : 'pointage.create', 'attendance', rec.id, { driverName: rec.driverName, driverCode: driver.code, day, before: snapshot(before), after: snapshot(rec), reason: g.reason, override: g.overridden }, driver.hub?.code)
    return NextResponse.json({ ok: true, status: rec.status, workedMinutes: rec.workedMinutes, lateMinutes: rec.lateMinutes })
  } catch (e) { return fail(e) }
}
