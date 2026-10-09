import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { computeKpis, computeCsat, computeOtpCoverage, computeProofCoverage, computeGeoCompliance, computeOfflineActions, ETA_ACCURACY_FORMULA, type EtaAccuracyKpi } from '@/lib/ops-kpis'
import { etaAccuracy } from '@/lib/ops-eta'
import { computePay, type PayConfig } from '@/lib/ops-pay'
import { cached } from '@/lib/ops-cache'
import { dayOfTz, dayBoundsTz, localDay, addDays, attendanceKeyTz } from '@/lib/tz'

const DAY_RE = /^\d{4}-\d\d-\d\d$/

async function build(from: string, to: string, hub: string | undefined) {
  const start = dayBoundsTz(from).from, end = dayBoundsTz(to).to
  const days = Math.max(1, Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86_400_000) + 1)

  const [orders, vehicles, drivers] = await Promise.all([
    prisma.opsOrder.findMany({
      where: { slotStart: { gte: start, lt: end }, ...(hub ? { hubCode: hub } : {}) }, take: 100_000,
      select: { id: true, status: true, slotEnd: true, deliveredAt: true, otpVerifiedAt: true, deliveryGeoOk: true, missingItems: true, attemptCount: true, cancelReason: true, driver: { select: { vehicleId: true } } },
    }),
    prisma.opsVehicle.findMany({ where: { status: { not: 'out_of_service' }, ...(hub ? { hub: { code: hub } } : {}) }, select: { id: true } }),
    prisma.opsDriver.findMany({ where: { status: { not: 'off' }, ...(hub ? { hub: { code: hub } } : {}) }, include: { hub: { select: { code: true } } }, orderBy: { code: 'asc' } }),
  ])
  const vehicleIds = vehicles.map(v => v.id)
  const names = drivers.map(d => `${d.firstName} ${d.lastName}`)

  // Heures pointées (arrivée → départ) — journées complètes uniquement
  const att = await prisma.driverAttendance.findMany({
    where: { date: { gte: attendanceKeyTz(from), lte: attendanceKeyTz(to) }, checkIn: { not: null }, checkOut: { not: null }, ...(hub ? { driverName: { in: names } } : {}) },
    select: { checkIn: true, checkOut: true },
  })
  const hoursWorked = att.reduce((s, a) => { const h = ((a.checkOut as Date).getTime() - (a.checkIn as Date).getTime()) / 3_600_000; return h > 0 && h < 20 ? s + h : s }, 0)

  // Jours-véhicule actifs : missions du jour + véhicule du livreur ayant livré ce jour-là
  const vehicleDays = new Set<string>()
  const missions = await prisma.opsMission.findMany({ where: { day: { gte: attendanceKeyTz(from), lte: attendanceKeyTz(to) }, ...(hub ? { hubCode: hub } : {}) }, select: { vehicleId: true, day: true } })
  for (const m of missions) vehicleDays.add(`${m.vehicleId}|${m.day.toISOString().slice(0, 10)}`)
  for (const o of orders) if (o.status === 'DELIVERED' && o.deliveredAt && o.driver?.vehicleId) vehicleDays.add(`${o.driver.vehicleId}|${localDay(o.deliveredAt.getTime())}`)

  // Coûts : paie (même calcul que /api/ops/pay), carburant, entretien
  const [fuelAgg, maintAgg] = await Promise.all([
    prisma.opsFuelLog.aggregate({ where: { date: { gte: start, lt: end }, ...(hub ? { vehicleId: { in: vehicleIds } } : {}) }, _sum: { amountMad: true } }),
    prisma.opsMaintenance.aggregate({ where: { date: { gte: start, lt: end }, status: 'done', ...(hub ? { vehicleId: { in: vehicleIds } } : {}) }, _sum: { costMad: true } }),
  ])
  let pay: number | null = null
  try {
    const cfg = await prisma.opsPayConfig.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } }) as unknown as PayConfig
    const chauffeurOfVehicle = new Map(drivers.filter(d => d.jobType === 'chauffeur' && d.vehicleId).map(d => [d.vehicleId as string, d.id]))
    const owner = (d: (typeof drivers)[number]) => (d.jobType === 'helper' && d.vehicleId ? chauffeurOfVehicle.get(d.vehicleId) ?? d.id : d.id)
    const byName = new Map(drivers.map(d => [`${d.firstName} ${d.lastName}`, d]))
    const [pa, po] = await Promise.all([
      prisma.driverAttendance.findMany({ where: { driverName: { in: names }, date: { gte: attendanceKeyTz(from), lte: attendanceKeyTz(to) } }, select: { driverName: true, date: true, status: true } }),
      prisma.opsOrder.findMany({ where: { driverId: { in: [...new Set(drivers.map(owner))] }, OR: [{ status: 'DELIVERED', deliveredAt: { gte: start, lt: end } }, { status: 'NO_SHOW', noShowAt: { gte: start, lt: end } }] }, select: { driverId: true, status: true, deliveredAt: true, noShowAt: true, slotEnd: true } }),
    ])
    const lines = computePay(cfg, drivers.map(d => ({ id: d.id, code: d.code, name: `${d.firstName} ${d.lastName}`, hubCode: d.hub?.code ?? null, dailyRate: d.dailyRate })),
      pa.flatMap(a => { const d = byName.get(a.driverName); return d ? [{ driverId: d.id, day: a.date.toISOString().slice(0, 10), status: a.status }] : [] }),
      po.flatMap(o => { const at = (o.deliveredAt ?? o.noShowAt) as Date; return drivers.filter(d => owner(d) === o.driverId).map(d => ({ driverId: d.id, day: localDay(at.getTime()), status: o.status, onTime: o.status === 'DELIVERED' && at <= o.slotEnd })) }))
    pay = Math.round(lines.reduce((s, l) => s + l.net, 0) * 100) / 100
  } catch (e) { console.warn('[kpis] paie indisponible', e instanceof Error ? e.message : e) }

  const k = computeKpis(orders, { hoursWorked, vehicleDaysActive: vehicleDays.size, vehicleCount: vehicles.length, days, pay, fuel: fuelAgg._sum.amountMad ?? 0, maintenance: maintAgg._sum.costMad ?? 0 })

  // Sprint 19 : satisfaction client, précision ETA, couverture du code de remise (chacun isolé : un échec ne casse pas les KPIs existants)
  let csat: ReturnType<typeof computeCsat> | null = null
  try {
    const ratings = await prisma.opsDeliveryRating.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { score: true }, take: 100_000 })
    csat = computeCsat(ratings.map(r => r.score), k.counts.delivered)
  } catch (e) { console.warn('[kpis] csat indisponible', e instanceof Error ? e.message : e) }
  let eta: EtaAccuracyKpi | null = null
  try {
    const a = await etaAccuracy(from, to, hub)
    eta = { mae: a.mae, withinTolerancePct: a.withinTolerancePct, samples: a.samples, insufficient: a.insufficient, formula: ETA_ACCURACY_FORMULA }
  } catch (e) { console.warn('[kpis] précision ETA indisponible', e instanceof Error ? e.message : e) }
  const otpCoverage = computeOtpCoverage(k.counts.delivered, orders.filter(o => o.status === 'DELIVERED' && o.otpVerifiedAt).length)

  // Sprint 20 : preuves, conformité géographique, actions de l'application livreur (chacun isolé)
  const deliveredOrders = orders.filter(o => o.status === 'DELIVERED')
  let proofCoverage: ReturnType<typeof computeProofCoverage> | null = null
  try {
    // Preuves créées autour de la période (photo prise au plus tard quelques jours après le créneau) ; jointure en mémoire, pas de IN géant
    const grouped = await prisma.opsProof.groupBy({ by: ['orderId'], where: { kind: 'delivery', createdAt: { gte: start, lt: new Date(end.getTime() + 7 * 86_400_000) } } })
    const withPhoto = new Set(grouped.map(g => g.orderId))
    proofCoverage = computeProofCoverage(deliveredOrders.length, deliveredOrders.filter(o => o.otpVerifiedAt || withPhoto.has(o.id)).length)
  } catch (e) { console.warn('[kpis] couverture des preuves indisponible', e instanceof Error ? e.message : e) }
  const geoCompliance = computeGeoCompliance(deliveredOrders.map(o => o.deliveryGeoOk))
  let offlineActions: ReturnType<typeof computeOfflineActions> | null = null
  try {
    const where = { createdAt: { gte: start, lt: end }, ...(hub ? { driverCode: { in: drivers.map(d => d.code) } } : {}) }
    const [total, failed] = await Promise.all([prisma.opsDriverAction.count({ where }), prisma.opsDriverAction.count({ where: { ...where, ok: false } })])
    offlineActions = computeOfflineActions(total, failed)
  } catch (e) { console.warn('[kpis] actions livreur indisponibles', e instanceof Error ? e.message : e) }
  return { from, to, hub: hub ?? null, days, ...k, csat, etaAccuracy: eta, otpCoverage, proofCoverage, geoCompliance, offlineActions }
}

// GET /api/ops/kpis?from=&to=&hub= — KPIs de référence (OTIF, annulations, 1er passage, livraisons/heure, flotte, coût/livraison) avec leur FORMULE. VIEWER+.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'VIEWER')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const to = DAY_RE.test(sp.get('to') ?? '') ? (sp.get('to') as string) : dayOfTz('today')
    const from = DAY_RE.test(sp.get('from') ?? '') ? (sp.get('from') as string) : addDays(to, -29)
    if (from > to) return NextResponse.json({ error: 'from doit précéder to' }, { status: 400 })
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) return NextResponse.json({ error: 'Période limitée à 366 jours' }, { status: 400 })
    const hub = sp.get('hub') || undefined
    return NextResponse.json(await cached(`kpis|${from}|${to}|${hub ?? ''}`, 30_000, () => build(from, to, hub)))
  } catch (e) { return fail(e) }
}
