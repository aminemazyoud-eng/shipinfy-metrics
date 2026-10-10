/**
 * lib/ops-costing.ts — « Chiffrage » (accès base, LECTURE seule des autres modules) : assemble les journées-équipes
 * à partir de OpsOrder / OpsTour / OpsMission / OpsFuelLog / OpsMaintenance / OpsPayRun(Line) et appelle la logique pure
 * de lib/ops-costing-core.ts. Seule écriture : les paramètres (OpsCostParam).
 * Coût chauffeur/helper : lignes de paie FIGÉES si le mois est validé/payé (estimated:false), sinon tarif du jour (estimated:true).
 */
import { prisma } from '@/lib/prisma'
import { ACTIVE_SOURCE } from '@/lib/ops-data'
import { CFG } from '@/lib/ops-config'
import { dayBoundsTz, localDay, attendanceKeyTz, dayOfTz, addDays } from '@/lib/tz'
import {
  resolveParams, computeTeamDays, COST_PARAM_DEFS, type CostParams, type TeamDay, type TeamDayInput, type VehicleRange, type FleetStat,
} from '@/lib/ops-costing-core'

export * from '@/lib/ops-costing-core'

/** Paramètres effectifs (défauts + surcharges en base). `fuel.priceMad` = 0 reprend le prix gasoil de Paramètres généraux. */
export async function loadParams(): Promise<{ params: CostParams; stored: Record<string, { value: number; updatedAt: string }> }> {
  const rows = await prisma.opsCostParam.findMany()
  const stored: Record<string, { value: number; updatedAt: string }> = {}
  for (const r of rows) stored[r.key] = { value: r.value, updatedAt: r.updatedAt.toISOString() }
  const params = resolveParams(Object.fromEntries(rows.map(r => [r.key, r.value])))
  if (!(params['fuel.priceMad'] > 0)) params['fuel.priceMad'] = CFG.fuelPriceDiesel
  return { params, stored }
}

export async function saveParams(clean: Record<string, number>): Promise<void> {
  const note = (k: string) => COST_PARAM_DEFS.find(d => d.key === k)?.label ?? null
  await prisma.$transaction(Object.entries(clean).map(([key, value]) => prisma.opsCostParam.upsert({ where: { key }, update: { value }, create: { key, value, note: note(key) } })))
}

export async function resetParams(): Promise<void> { await prisma.opsCostParam.deleteMany({}) }

const months = (from: string, to: string): string[] => {
  const out: string[] = []
  for (let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7); m++) { if (m > 12) { m = 1; y++ } out.push(`${y}-${String(m).padStart(2, '0')}`) }
  return [...new Set(out)]
}
const kmDelta = (a: number | null, b: number | null): number => (a != null && b != null && b > a && b - a < 1000 ? b - a : 0)

export interface CostingData {
  from: string; to: string; params: CostParams; days: TeamDay[]; fleet: FleetStat[]
  meta: { deliveredTotal: number; deliveredWithoutTeam: number; frozenMonths: string[]; tours: number; paySource: string }
}

export async function computeCosting(from: string, to: string, opts: { hub?: string } = {}): Promise<CostingData> {
  const { params } = await loadParams()
  const { from: start } = dayBoundsTz(from), { to: end } = dayBoundsTz(to)

  const [orders, drivers, vehicles, tours, missions, fuel, maint, payCfg, runs] = await Promise.all([
    prisma.opsOrder.findMany({ where: { source: ACTIVE_SOURCE, status: 'DELIVERED', deliveredAt: { gte: start, lt: end } }, take: 200_000, select: { driverId: true, deliveredAt: true, hubCode: true, slotLabel: true, tourId: true } }),
    prisma.opsDriver.findMany({ include: { hub: { select: { code: true } } } }),
    prisma.opsVehicle.findMany({ select: { id: true, plate: true, status: true, consumptionL100: true } }),
    prisma.opsTour.findMany({ where: { day: { gte: from, lte: to } } }),
    prisma.opsMission.findMany({ where: { day: { gte: attendanceKeyTz(from), lte: attendanceKeyTz(to) }, driverCode: { not: null } }, select: { day: true, driverCode: true, startKm: true, endKm: true } }),
    prisma.opsFuelLog.findMany({ where: { date: { gte: start, lt: end } }, select: { vehicleId: true, liters: true, amountMad: true } }),
    prisma.opsMaintenance.findMany({ where: { date: { gte: start, lt: end }, status: 'done', type: { not: 'assurance' } }, select: { vehicleId: true, costMad: true } }),
    prisma.opsPayConfig.findUnique({ where: { id: 'default' } }),
    prisma.opsPayRun.findMany({ where: { period: { in: months(from, to) }, status: { in: ['validated', 'paid'] } }, select: { id: true, period: true } }),
  ])

  // ── Paie figée : période → code → coût journalier moyen (final ÷ jours payés)
  const frozen = new Map<string, Map<string, number>>()
  if (runs.length) {
    const lines = await prisma.opsPayRunLine.findMany({ where: { runId: { in: runs.map(r => r.id) } }, select: { runId: true, driverCode: true, final: true, paidDays: true } })
    const periodOf = new Map(runs.map(r => [r.id, r.period]))
    for (const l of lines) if (l.paidDays > 0) { const per = periodOf.get(l.runId) as string; const m = frozen.get(per) ?? new Map<string, number>(); m.set(l.driverCode, l.final / l.paidDays); frozen.set(per, m) }
  }

  const byId = new Map(drivers.map(d => [d.id, d])), byCode = new Map(drivers.map(d => [d.code, d]))
  const vehByPlate = new Map(vehicles.map(v => [v.plate, v])), vehById = new Map(vehicles.map(v => [v.id, v]))
  const chauffeurOf = new Map(drivers.filter(d => d.jobType === 'chauffeur' && d.vehicleId).map(d => [d.vehicleId as string, d]))
  const helperOf = new Map(drivers.filter(d => d.jobType === 'helper' && d.vehicleId && d.status !== 'off').map(d => [d.vehicleId as string, d]))
  const owner = (id: string) => { const d = byId.get(id); return d && d.jobType === 'helper' && d.vehicleId ? chauffeurOf.get(d.vehicleId) ?? d : d }

  // ── Regroupement des livraisons par (jour, chauffeur)
  interface Acc { day: string; code: string; delivered: number; byHub: Record<string, number>; bySlot: Record<string, number>; byTour: Map<string, number> }
  const teams = new Map<string, Acc>()
  let withoutTeam = 0
  for (const o of orders) {
    const d = o.driverId ? owner(o.driverId) : undefined
    if (!d || !o.deliveredAt) { withoutTeam++; continue }
    const day = localDay(o.deliveredAt.getTime()), k = `${day}|${d.code}`
    const a: Acc = teams.get(k) ?? { day, code: d.code, delivered: 0, byHub: {}, bySlot: {}, byTour: new Map() }
    a.delivered++
    const hub = o.hubCode ?? '—', slot = o.slotLabel ?? '—'
    a.byHub[hub] = (a.byHub[hub] ?? 0) + 1; a.bySlot[slot] = (a.bySlot[slot] ?? 0) + 1
    if (o.tourId) a.byTour.set(o.tourId, (a.byTour.get(o.tourId) ?? 0) + 1)
    teams.set(k, a)
  }
  const toursBy = new Map<string, typeof tours>()
  for (const t of tours) { const k = `${t.day}|${t.driverCode}`; toursBy.set(k, [...(toursBy.get(k) ?? []), t]); if (!teams.has(k)) teams.set(k, { day: t.day, code: t.driverCode, delivered: 0, byHub: {}, bySlot: {}, byTour: new Map() }) }
  const missionKm = new Map<string, number>()
  for (const m of missions) { const k = `${m.day.toISOString().slice(0, 10)}|${m.driverCode}`; missionKm.set(k, (missionKm.get(k) ?? 0) + kmDelta(m.startKm, m.endKm)) }

  const helperFallback = payCfg?.helperDailyRate ?? params['helper.dailyRateFallback']
  const bonusThr = payCfg?.bonusThreshold ?? 10, bonusPer = payCfg?.bonusPerOrder ?? 0
  const helperOn = params['helper.enabled'] !== 0

  const inputs: TeamDayInput[] = []
  for (const [k, a] of teams) {
    const drv = byCode.get(a.code)
    const ts = toursBy.get(k) ?? []
    const plate = ts.find(t => t.vehicleRef)?.vehicleRef ?? null
    const veh = (plate ? vehByPlate.get(plate) : undefined) ?? (drv?.vehicleId ? vehById.get(drv.vehicleId) : undefined)
    const period = a.day.slice(0, 7)
    const fz = frozen.get(period)

    const dFrozen = fz?.get(a.code)
    const driverDaily = dFrozen != null ? { amount: dFrozen, frozen: true } : { amount: (drv?.dailyRate ?? 150) + Math.max(0, a.delivered - bonusThr) * bonusPer, frozen: false }
    const helperCode = helperOn ? ts.find(t => t.helperCode)?.helperCode ?? (veh ? helperOf.get(veh.id)?.code ?? null : null) : null
    let helperDaily: TeamDayInput['helperDaily'] = null
    if (helperCode) {
      const hFrozen = fz?.get(helperCode), h = byCode.get(helperCode)
      helperDaily = hFrozen != null ? { amount: hFrozen, frozen: true } : { amount: h && h.dailyRate > 0 ? h.dailyRate : helperFallback, frozen: false }
    }

    // rotations : tournées saisies si présentes (commandes rattachées par tourId), sinon créneaux distincts (estimé)
    let rotationOrders: number[], rotations: number, fromTours = false
    if (ts.length) {
      fromTours = true; rotations = ts.length
      const counts = ts.map(t => a.byTour.get(t.id) ?? 0)
      rotationOrders = counts.some(c => c > 0) ? counts : Object.values(a.bySlot)
    } else { rotationOrders = Object.values(a.bySlot); rotations = rotationOrders.length }

    const kmT = ts.reduce((s, t) => s + kmDelta(t.kmStart, t.kmEnd), 0)
    const hubCode = ts.find(t => t.hubCode)?.hubCode ?? Object.entries(a.byHub).sort((x, y) => y[1] - x[1])[0]?.[0] ?? drv?.hub?.code ?? null
    inputs.push({
      day: a.day, driverCode: a.code, driverName: drv ? `${drv.firstName} ${drv.lastName}` : a.code, helperCode, vehicleId: veh?.id ?? null, plate: veh?.plate ?? plate, hubCode,
      delivered: a.delivered, byHub: a.byHub, bySlot: a.bySlot, rotationOrders, rotationsFromTours: fromTours, rotations,
      kmTour: kmT > 0 ? kmT : null, kmMission: missionKm.get(k) || null, driverDaily, helperDaily, consumptionL100: veh?.consumptionL100 ?? null,
    })
  }

  // ── Carburant / entretien réels par véhicule (sur la période)
  const vr = new Map<string, VehicleRange>()
  const slot = (id: string) => { const v = vr.get(id) ?? { fuelAmount: null, fuelLiters: null, maintAmount: null }; vr.set(id, v); return v }
  for (const f of fuel) { const v = slot(f.vehicleId); v.fuelAmount = (v.fuelAmount ?? 0) + f.amountMad; v.fuelLiters = (v.fuelLiters ?? 0) + f.liters }
  for (const m of maint) { const v = slot(m.vehicleId); v.maintAmount = (v.maintAmount ?? 0) + m.costMad }

  let days = computeTeamDays(inputs, vr, params)
  if (opts.hub) days = days.filter(t => t.hubCode === opts.hub)
  days.sort((x, y) => x.day.localeCompare(y.day) || x.driverCode.localeCompare(y.driverCode))

  const fleet: FleetStat[] = vehicles.map(v => ({ vehicleId: v.id, plate: v.plate, status: v.status, declaredL100: v.consumptionL100, fuelLiters: vr.get(v.id)?.fuelLiters ?? null, fuelAmount: vr.get(v.id)?.fuelAmount ?? null }))
  const frozenMonths = [...frozen.keys()].sort()
  return { from, to, params, days, fleet, meta: { deliveredTotal: orders.length, deliveredWithoutTeam: withoutTeam, frozenMonths, tours: tours.length, paySource: frozenMonths.length ? 'paie figée (' + frozenMonths.join(', ') + ') sinon estimation au tarif du jour' : 'estimation au tarif du jour (aucun mois clôturé sur la période)' } }
}

const DAY_RE = /^\d{4}-\d\d-\d\d$/
/** Période d'une requête (?from&to, défaut : 30 derniers jours) ; erreur claire sinon. */
export function parseRange(sp: URLSearchParams): { from: string; to: string } | { error: string } {
  const to = DAY_RE.test(sp.get('to') ?? '') ? (sp.get('to') as string) : dayOfTz('today')
  const from = DAY_RE.test(sp.get('from') ?? '') ? (sp.get('from') as string) : addDays(to, -29)
  if (from > to) return { error: 'from doit précéder to' }
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) return { error: 'Période limitée à 366 jours' }
  return { from, to }
}
