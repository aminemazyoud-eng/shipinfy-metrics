/**
 * lib/ops-pilot.ts — chargement des données du « pilotage intelligent » (Sprint 21) et application d'une réaffectation.
 * Les décisions viennent des fonctions pures (ops-reassign / ops-predictive / ops-gamification / ops-planning-auto).
 */
import { prisma } from '@/lib/prisma'
import { ACTIVE_SOURCE } from '@/lib/ops-data'
import { TERMINAL_STATUSES } from '@/lib/ops-defs'
import { dayBoundsTz, addDays } from '@/lib/tz'
import { attendanceByName } from '@/lib/ops-attendance'
import { proposeReassignments, type Reassignment } from '@/lib/ops-reassign'
import { predictOverruns } from '@/lib/ops-predictive'
import { leaderboard, type DayResult } from '@/lib/ops-gamification'
import { enqueueAssign } from '@/lib/ops-sync'
import { bumpOpsEpoch } from '@/lib/ops-cache'

export async function loadPilot(day: string, hub: string | null) {
  const { from, to } = dayBoundsTz(day)
  const now = Date.now()
  const [orders, drivers, att] = await Promise.all([
    prisma.opsOrder.findMany({
      where: { source: ACTIVE_SOURCE, slotStart: { gte: from, lt: to }, ...(hub ? { hubCode: hub } : {}) },
      select: { id: true, externalId: true, reference: true, status: true, slotStart: true, slotEnd: true, lat: true, lng: true, driverId: true, deliveredAt: true },
    }),
    prisma.opsDriver.findMany({ where: { status: 'active', jobType: 'chauffeur', ...(hub ? { hub: { code: hub } } : {}) }, select: { id: true, code: true, firstName: true, lastName: true } }),
    attendanceByName(day),
  ])
  const avail = new Map(drivers.map(d => { const s = att.get(`${d.firstName} ${d.lastName}`)?.status; return [d.id, s !== 'absent' && s !== 'leave'] as const }))
  const open = orders.filter(o => !(TERMINAL_STATUSES as readonly string[]).includes(o.status))
  const load = (id: string) => open.filter(o => o.driverId === id).length

  const proposals = proposeReassignments(
    orders.map(o => ({ id: o.id, status: o.status, driverId: o.driverId, slotStart: o.slotStart.getTime(), slotEnd: o.slotEnd.getTime(), lat: o.lat, lng: o.lng })),
    drivers.map(d => ({ id: d.id, code: d.code, load: load(d.id), points: [], available: avail.get(d.id) ?? true })),
    now,
  )
  const code = new Map(drivers.map(d => [d.id, d.code]))
  const ref = new Map(orders.map(o => [o.id, o.reference ?? o.externalId]))

  const predictions = predictOverruns(
    orders.filter(o => o.driverId).map(o => ({ id: o.id, driverId: o.driverId as string, slotEnd: o.slotEnd.getTime(), open: open.includes(o), deliveredAt: o.deliveredAt?.getTime() ?? null })),
    now,
  ).map(p => ({ ...p, driver: code.get(p.driverId) ?? p.driverId, reference: ref.get(p.orderId) ?? p.orderId }))

  return {
    day, hub,
    reassign: proposals.map(r => ({ ...r, fromCode: r.from ? code.get(r.from) ?? r.from : null, toCode: code.get(r.to) ?? r.to, reference: ref.get(r.orderId) ?? r.orderId })),
    predictions,
  }
}

/** Classement sur `days` jours (livraisons à l'heure = livrée au plus tard à la fin du créneau). */
export async function loadLeaderboard(day: string, days = 14) {
  const { from } = dayBoundsTz(addDays(day, -(days - 1)))
  const { to } = dayBoundsTz(day)
  const rows = await prisma.opsOrder.findMany({
    where: { source: ACTIVE_SOURCE, status: 'DELIVERED', driverId: { not: null }, deliveredAt: { gte: from, lt: to } },
    select: { driverId: true, hubCode: true, slotEnd: true, deliveredAt: true },
  })
  const drivers = await prisma.opsDriver.findMany({ select: { id: true, code: true, firstName: true } })
  const info = new Map(drivers.map(d => [d.id, d]))
  const per = new Map<string, DayResult>()
  for (const r of rows) {
    const d = r.deliveredAt as Date, dayKey = d.toISOString().slice(0, 10)
    const id = r.driverId as string, k = `${id}|${dayKey}`
    const cur = per.get(k) ?? { driverId: id, hub: r.hubCode ?? '—', day: dayKey, delivered: 0, onTime: 0 }
    cur.delivered++; if (d.getTime() <= r.slotEnd.getTime()) cur.onTime++
    per.set(k, cur)
  }
  const lb = leaderboard([...per.values()])
  for (const hub of Object.keys(lb)) for (const s of lb[hub]) { const i = info.get(s.driverId); (s as unknown as { name: string }).name = i ? `${i.firstName} (${i.code})` : s.driverId }
  return lb
}

/** Applique des réaffectations : compare-and-set (la commande doit encore être chez `from`, non en livraison) ; push back-office via l'outbox. */
export async function applyReassignments(items: Pick<Reassignment, 'orderId' | 'from' | 'to'>[]) {
  const now = new Date()
  const drivers = await prisma.opsDriver.findMany({ where: { id: { in: [...new Set(items.map(i => i.to))] } }, select: { id: true, code: true } })
  const code = new Map(drivers.map(d => [d.id, d.code]))
  const moved: { orderId: string; externalId: string; courierRef: string }[] = []
  for (const it of items) {
    const to = code.get(it.to)
    if (!to || !it.from) continue
    const r = await prisma.$queryRaw<{ id: string; externalId: string }[]>`
      UPDATE "OpsOrder" SET "driverId" = ${it.to}, "courierRef" = ${to}, "assignedAt" = ${now}
      WHERE "id" = ${it.orderId} AND "driverId" = ${it.from} AND "status" IN ('ASSIGNED','IN_TRANSPORT')
      RETURNING "id", "externalId"`
    if (r[0]) moved.push({ orderId: r[0].id, externalId: r[0].externalId, courierRef: to })
  }
  if (moved.length) {
    await prisma.opsOrderEvent.createMany({ data: moved.map(m => ({ orderId: m.orderId, fromStatus: 'ASSIGNED', toStatus: 'ASSIGNED', at: now, source: 'reassign' })), skipDuplicates: true })
    await enqueueAssign(moved.map(m => ({ externalId: m.externalId, courierRef: m.courierRef })))
    bumpOpsEpoch()
  }
  return moved.length
}
