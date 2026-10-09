import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { attendanceKey } from '@/lib/ops-time'
import { localDay as tzLocalDay } from '@/lib/tz'

const DAY = 86_400_000
const localDay = (d: Date) => tzLocalDay(d.getTime()) // jour local Africa/Casablanca réel (lib/tz)

// GET /api/ops/missions?days=7 — missions (départ / retour du véhicule dans la journée), pleins et entretiens récents horodatés
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const days = Math.min(Number(new URL(req.url).searchParams.get('days')) || 7, 60)
    const since = new Date(Date.now() - days * DAY)
    const [missions, fuel, maint, vehicles, people] = await Promise.all([
      prisma.opsMission.findMany({ where: { OR: [{ startAt: { gte: since } }, { endAt: null }] }, orderBy: { startAt: 'desc' }, take: 300 }),
      prisma.opsFuelLog.findMany({ where: { date: { gte: since } }, orderBy: { date: 'desc' }, take: 60 }),
      prisma.opsMaintenance.findMany({ where: { date: { gte: since } }, orderBy: { date: 'desc' }, take: 30 }),
      prisma.opsVehicle.findMany({ select: { id: true, plate: true } }),
      prisma.opsDriver.findMany({ select: { code: true, firstName: true, lastName: true } }),
    ])
    const plate = new Map(vehicles.map(v => [v.id, v.plate])); const name = new Map(people.map(p => [p.code, `${p.firstName} ${p.lastName}`]))
    const litersBy = new Map<string, number>(); for (const f of fuel) if (f.missionId) litersBy.set(f.missionId, (litersBy.get(f.missionId) ?? 0) + f.liters)
    return NextResponse.json({
      missions: missions.map(m => ({
        id: m.id, vehicleId: m.vehicleId, plate: plate.get(m.vehicleId) ?? '—', hubCode: m.hubCode, day: m.day, startAt: m.startAt, endAt: m.endAt, startKm: m.startKm, endKm: m.endKm, status: m.status,
        driver: m.driverCode ? name.get(m.driverCode) ?? m.driverCode : null, helper: m.helperCode ? name.get(m.helperCode) ?? m.helperCode : null,
        km: m.startKm != null && m.endKm != null ? Math.round((m.endKm - m.startKm) * 10) / 10 : null, minutes: m.endAt ? Math.round((m.endAt.getTime() - m.startAt.getTime()) / 60_000) : null,
        liters: Math.round((litersBy.get(m.id) ?? 0) * 10) / 10,
      })),
      open: missions.filter(m => !m.endAt).map(m => ({ vehicleId: m.vehicleId, id: m.id, startAt: m.startAt, startKm: m.startKm })),
      fuel: fuel.map(f => ({ id: f.id, vehicleId: f.vehicleId, plate: plate.get(f.vehicleId) ?? '—', date: f.date, liters: f.liters, amountMad: f.amountMad, odometerKm: f.odometerKm, station: f.station, missionId: f.missionId })),
      maintenance: maint.map(m => ({ id: m.id, vehicleId: m.vehicleId, plate: plate.get(m.vehicleId) ?? '—', date: m.date, type: m.type, costMad: m.costMad, odometerKm: m.odometerKm, status: m.status })),
    })
  } catch (e) { return fail(e) }
}

// POST /api/ops/missions
//   { action:'start', vehicleId, startKm?, startAt? }  départ de la journée
//   { action:'end', id, endKm?, endAt? }               fin de la journée (retour au hub)
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as { action: string; vehicleId?: string; id?: string; startKm?: number | string; endKm?: number | string; startAt?: string; endAt?: string; notes?: string }
    const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v))

    if (b.action === 'start' && b.vehicleId) {
      const v = await prisma.opsVehicle.findUnique({ where: { id: b.vehicleId }, include: { hub: { select: { code: true } }, crew: { select: { code: true, jobType: true } } } })
      if (!v) return NextResponse.json({ error: 'Véhicule inconnu' }, { status: 404 })
      if (v.status !== 'active') return NextResponse.json({ error: 'Véhicule indisponible (entretien ou hors service)' }, { status: 409 })
      if (await prisma.opsMission.findFirst({ where: { vehicleId: v.id, endAt: null } })) return NextResponse.json({ error: 'Une mission est déjà en cours pour ce véhicule' }, { status: 409 })
      const startAt = b.startAt ? new Date(b.startAt) : new Date(); const startKm = num(b.startKm)
      const m = await prisma.opsMission.create({ data: { vehicleId: v.id, hubCode: v.hub?.code ?? null, driverCode: v.crew.find(c => c.jobType === 'chauffeur')?.code ?? null, helperCode: v.crew.find(c => c.jobType === 'helper')?.code ?? null, day: attendanceKey(localDay(startAt)), startAt, startKm, notes: b.notes ?? null } })
      if (startKm != null && startKm > v.odometerKm) await prisma.opsVehicle.update({ where: { id: v.id }, data: { odometerKm: startKm } })
      await audit(auth.session, 'fleet.mission_start', 'vehicle', v.plate, { startKm }, v.hub?.code)
      return NextResponse.json({ ok: true, id: m.id })
    }

    if (b.action === 'end' && b.id) {
      const m = await prisma.opsMission.findUnique({ where: { id: b.id } })
      if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
      if (m.endAt) return NextResponse.json({ error: 'Mission déjà clôturée' }, { status: 409 })
      const endAt = b.endAt ? new Date(b.endAt) : new Date(); const endKm = num(b.endKm)
      if (endAt < m.startAt) return NextResponse.json({ error: 'La fin ne peut pas précéder le départ' }, { status: 400 })
      if (endKm != null && m.startKm != null && endKm < m.startKm) return NextResponse.json({ error: 'Le kilométrage de retour est inférieur au départ' }, { status: 400 })
      await prisma.opsMission.update({ where: { id: m.id }, data: { endAt, endKm, status: 'terminee', ...(b.notes ? { notes: b.notes } : {}) } })
      if (endKm != null) { const v = await prisma.opsVehicle.findUnique({ where: { id: m.vehicleId } }); if (v && endKm > v.odometerKm) await prisma.opsVehicle.update({ where: { id: v.id }, data: { odometerKm: endKm } }) }
      await audit(auth.session, 'fleet.mission_end', 'vehicle', m.vehicleId, { endKm }, m.hubCode)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'action invalide' }, { status: 400 })
  } catch (e) { return fail(e) }
}
