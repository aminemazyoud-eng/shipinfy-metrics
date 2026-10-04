import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { CFG } from '@/lib/ops-config'

const DAY = 86_400_000

// GET /api/ops/fleet?days=30 — flotte : véhicule, livreur, hub, gasoil (litres, coût, L/100 réel vs théorique), alertes d'entretien
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const days = Math.min(Number(new URL(req.url).searchParams.get('days')) || 30, 365)
    const since = new Date(Date.now() - days * DAY)
    const [vehicles, fuel, maint] = await Promise.all([
      prisma.opsVehicle.findMany({ include: { hub: { select: { code: true, name: true } }, crew: { select: { code: true, firstName: true, lastName: true, jobType: true } } }, orderBy: [{ hubId: 'asc' }, { plate: 'asc' }] }),
      prisma.opsFuelLog.findMany({ where: { date: { gte: since } }, orderBy: { date: 'asc' } }),
      prisma.opsMaintenance.findMany({ orderBy: { date: 'desc' } }),
    ])
    const now = Date.now()
    const out = vehicles.map(v => {
      const f = fuel.filter(x => x.vehicleId === v.id)
      const liters = f.reduce((s, x) => s + x.liters, 0), cost = f.reduce((s, x) => s + x.amountMad, 0)
      const odo = f.filter(x => x.odometerKm != null).map(x => x.odometerKm as number)
      const km = odo.length >= 2 ? Math.max(...odo) - Math.min(...odo) : 0
      // L/100 réel : litres des pleins hors premier plein (le premier ne couvre pas la distance mesurée)
      const litersForKm = f.length > 1 ? f.slice(1).reduce((s, x) => s + x.liters, 0) : 0
      const real = km > 0 && litersForKm > 0 ? Math.round((litersForKm / km) * 1000) / 10 : null
      const m = maint.filter(x => x.vehicleId === v.id)
      const next = m.filter(x => x.nextDueDate || x.nextDueKm != null).map(x => ({ type: x.type, dueDate: x.nextDueDate, dueKm: x.nextDueKm }))
      const alerts = next.filter(n => (n.dueDate && n.dueDate.getTime() - now < CFG.docAlertDays * DAY) || (n.dueKm != null && n.dueKm - v.odometerKm < CFG.maintKmMargin))
      return {
        id: v.id, plate: v.plate, type: v.type, fuelType: v.fuelType, status: v.status, odometerKm: v.odometerKm, theoreticalL100: v.consumptionL100,
        hub: v.hub?.name ?? null, hubCode: v.hub?.code ?? null, driver: (() => { const c = v.crew.find(p => p.jobType === 'chauffeur'); return c ? `${c.firstName} ${c.lastName}` : null })(), helper: (() => { const h = v.crew.find(p => p.jobType === 'helper'); return h ? `${h.firstName} ${h.lastName}` : null })(),
        fuel: { liters: Math.round(liters * 10) / 10, cost: Math.round(cost), fills: f.length, km, realL100: real, costPerKm: km > 0 ? Math.round((cost / km) * 100) / 100 : null },
        maintenanceCost: Math.round(m.filter(x => x.date >= since).reduce((s, x) => s + x.costMad, 0)),
        lastMaintenance: m[0] ? { type: m[0].type, date: m[0].date } : null, alerts,
      }
    })
    return NextResponse.json({
      days, alertPct: CFG.consumptionAlertPct, vehicles: out,
      totals: { vehicles: out.length, active: out.filter(v => v.status === 'active').length, liters: Math.round(out.reduce((s, v) => s + v.fuel.liters, 0)), fuelCost: out.reduce((s, v) => s + v.fuel.cost, 0), maintenanceCost: out.reduce((s, v) => s + v.maintenanceCost, 0), alerts: out.reduce((s, v) => s + v.alerts.length, 0) },
    })
  } catch (e) { return fail(e) }
}

// POST /api/ops/fleet
//   { kind:'fuel', vehicleId, date?, liters, amountMad, odometerKm?, station? }
//   { kind:'maintenance', vehicleId, date?, type, costMad?, odometerKm?, notes?, nextDueKm?, nextDueDate?, status? }
//   { kind:'status', vehicleId, status }  (active | maintenance | out_of_service)
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as Record<string, unknown>
    const vehicle = await prisma.opsVehicle.findUnique({ where: { id: String(b.vehicleId) } })
    if (!vehicle) return NextResponse.json({ error: 'Véhicule inconnu' }, { status: 404 })
    const date = b.date ? new Date(String(b.date)) : new Date()
    // le plein / l'entretien est rattaché à la mission ouverte du véhicule à cette date (départ ≤ date, pas encore de retour ou retour ≥ date)
    const mission = await prisma.opsMission.findFirst({ where: { vehicleId: vehicle.id, startAt: { lte: date }, OR: [{ endAt: null }, { endAt: { gte: date } }] }, orderBy: { startAt: 'desc' } })
    const odo = b.odometerKm != null && b.odometerKm !== '' ? Number(b.odometerKm) : null
    const bumpOdo = odo != null && odo > vehicle.odometerKm ? [prisma.opsVehicle.update({ where: { id: vehicle.id }, data: { odometerKm: odo } })] : []

    if (b.kind === 'fuel') {
      const liters = Number(b.liters), amountMad = Number(b.amountMad)
      if (!(liters > 0) || !(amountMad >= 0)) return NextResponse.json({ error: 'Litres et montant requis' }, { status: 400 })
      await prisma.$transaction([prisma.opsFuelLog.create({ data: { vehicleId: vehicle.id, date, liters, amountMad, odometerKm: odo, station: b.station ? String(b.station) : null, missionId: mission?.id ?? null } }), ...bumpOdo])
      await audit(auth.session, 'fleet.fuel', 'vehicle', vehicle.plate, { liters, amountMad, odo })
    } else if (b.kind === 'maintenance') {
      if (!b.type) return NextResponse.json({ error: 'Type requis' }, { status: 400 })
      await prisma.$transaction([prisma.opsMaintenance.create({ data: { vehicleId: vehicle.id, date, type: String(b.type), costMad: Number(b.costMad) || 0, odometerKm: odo, notes: b.notes ? String(b.notes) : null, nextDueKm: b.nextDueKm ? Number(b.nextDueKm) : null, nextDueDate: b.nextDueDate ? new Date(String(b.nextDueDate)) : null, missionId: mission?.id ?? null, status: b.status === 'planned' ? 'planned' : 'done' } }), ...bumpOdo])
      await audit(auth.session, 'fleet.maintenance', 'vehicle', vehicle.plate, { type: b.type, cost: b.costMad })
    } else if (b.kind === 'status') {
      if (!['active', 'maintenance', 'out_of_service'].includes(String(b.status))) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
      await prisma.opsVehicle.update({ where: { id: vehicle.id }, data: { status: String(b.status) } })
      await audit(auth.session, 'fleet.status', 'vehicle', vehicle.plate, { status: b.status })
    } else return NextResponse.json({ error: 'kind invalide' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e) { return fail(e) }
}
