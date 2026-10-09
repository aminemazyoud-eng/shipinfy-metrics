/**
 * lib/ops-payrun.ts — clôture mensuelle de la paie (accès base). Les règles de calcul restent celles de computePay (lib/ops-pay.ts).
 * Un mois validé/payé est FIGÉ : les lectures servent les lignes enregistrées, jamais un recalcul au tarif courant.
 */
import { prisma } from '@/lib/prisma'
import { dayBounds, attendanceKey } from '@/lib/ops-time'
import { localDay } from '@/lib/tz'
import { ACTIVE_SOURCE } from '@/lib/ops-data'
import { computePay, type PayConfig, type PayLine } from '@/lib/ops-pay'
import { periodRange, nextStatus, checkAdjustment, finalOf, totalsOf, type RunStatus, type RunTotals } from '@/lib/ops-payrun-core'

export * from '@/lib/ops-payrun-core'

export type FrozenLine = PayLine & { jobType: string; adjustment: number; adjustmentNote: string | null; final: number }
export interface RunView {
  period: string; status: RunStatus; locked: boolean; config: PayConfig | null; totals: RunTotals
  note: string | null; createdBy: string | null; createdAt: string; validatedBy: string | null; validatedAt: string | null; paidBy: string | null; paidAt: string | null
  lines: FrozenLine[]
}
export class RunError extends Error { constructor(msg: string, public status = 409) { super(msg) } }

/** Calcul à la volée d'une plage de jours (mêmes requêtes et mêmes formules que /api/ops/pay). */
export async function computeRange(from: string, to: string, hub?: string): Promise<{ cfg: PayConfig & { id: string }; lines: (PayLine & { jobType: string })[] }> {
  const start = dayBounds(from).from, end = dayBounds(to).to
  const cfg = await prisma.opsPayConfig.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } })
  const drivers = await prisma.opsDriver.findMany({ where: { status: { not: 'off' }, ...(hub ? { hub: { code: hub } } : {}) }, include: { hub: { select: { code: true } } }, orderBy: { code: 'asc' } })
  // un helper partage les livraisons du chauffeur de son véhicule (c'est l'équipe qui livre)
  const chauffeurOfVehicle = new Map(drivers.filter(d => d.jobType === 'chauffeur' && d.vehicleId).map(d => [d.vehicleId as string, d.id]))
  const ordersOwner = (d: (typeof drivers)[number]) => (d.jobType === 'helper' && d.vehicleId ? chauffeurOfVehicle.get(d.vehicleId) ?? d.id : d.id)
  const ids = [...new Set(drivers.map(ordersOwner))]
  const byName = new Map(drivers.map(d => [`${d.firstName} ${d.lastName}`, d]))
  const [att, orders] = await Promise.all([
    prisma.driverAttendance.findMany({ where: { driverName: { in: drivers.map(d => `${d.firstName} ${d.lastName}`) }, date: { gte: attendanceKey(from), lte: attendanceKey(to) } }, select: { driverName: true, date: true, status: true } }),
    prisma.opsOrder.findMany({ where: { source: ACTIVE_SOURCE, driverId: { in: ids }, OR: [{ status: 'DELIVERED', deliveredAt: { gte: start, lt: end } }, { status: 'NO_SHOW', noShowAt: { gte: start, lt: end } }] }, select: { driverId: true, status: true, deliveredAt: true, noShowAt: true, slotEnd: true } }),
  ])
  const lines = computePay(cfg, drivers.map(d => ({ id: d.id, code: d.code, name: `${d.firstName} ${d.lastName}`, hubCode: d.hub?.code ?? null, dailyRate: d.dailyRate })),
    att.flatMap(a => { const d = byName.get(a.driverName); return d ? [{ driverId: d.id, day: a.date.toISOString().slice(0, 10), status: a.status }] : [] }),
    orders.flatMap(o => { const at = (o.deliveredAt ?? o.noShowAt) as Date; return drivers.filter(d => ordersOwner(d) === o.driverId).map(d => ({ driverId: d.id, day: localDay(at.getTime()), status: o.status, onTime: o.status === 'DELIVERED' && at <= o.slotEnd })) }))
  const jt = new Map(drivers.map(d => [d.code, d.jobType]))
  return { cfg, lines: lines.map(l => ({ ...l, jobType: jt.get(l.code) ?? 'chauffeur' })) }
}

/** Lignes d'un mois complet (bornes = jours locaux réels). */
export async function buildRunLines(period: string) {
  const { from, to } = periodRange(period)
  return computeRange(from, to)
}

const parseJson = <T>(s: string | null): T | null => { try { return s ? JSON.parse(s) as T : null } catch { return null } }
const iso = (d: Date | null) => (d ? d.toISOString() : null)


type RunRow = NonNullable<Awaited<ReturnType<typeof prisma.opsPayRun.findUnique>>>
type LineRow = Awaited<ReturnType<typeof prisma.opsPayRunLine.findMany>>[number]

function toView(run: RunRow, rows: LineRow[]): RunView {
  const lines: FrozenLine[] = rows.map(l => ({
    code: l.driverCode, name: l.driverName, hubCode: l.hubCode, jobType: l.jobType, dailyRate: l.dailyRate, daysPresent: 0, daysLate: l.daysLate, daysAbsent: l.daysAbsent, daysLeave: l.daysLeave, paidDays: l.paidDays,
    delivered: l.delivered, onTime: l.onTime, deliveredLate: l.deliveredLate, noShow: l.noShow, bonusOrders: l.bonusOrders, gross: l.gross, bonus: l.bonus, deductions: l.deductions, net: l.net,
    adjustment: l.adjustment, adjustmentNote: l.adjustmentNote, final: l.final,
  }))
  const snap = parseJson<{ config?: PayConfig }>(run.config)
  return {
    period: run.period, status: run.status as RunStatus, locked: run.status !== 'draft', config: snap?.config ?? null,
    // validé/payé : totaux figés ; brouillon : recalculés depuis les lignes courantes
    totals: (run.status !== 'draft' ? parseJson<RunTotals>(run.totals) : null) ?? totalsOf(lines), note: run.note, createdBy: run.createdBy, createdAt: run.createdAt.toISOString(),
    validatedBy: run.validatedBy, validatedAt: iso(run.validatedAt), paidBy: run.paidBy, paidAt: iso(run.paidAt), lines,
  }
}

/** Lecture d'une clôture (lignes figées) ; null si le mois n'a pas de clôture. */
export async function getRun(period: string): Promise<RunView | null> {
  const run = await prisma.opsPayRun.findUnique({ where: { period } })
  if (!run) return null
  return toView(run, await prisma.opsPayRunLine.findMany({ where: { runId: run.id }, orderBy: { driverCode: 'asc' } }))
}

/** Liste des clôtures (sans les lignes), plus récentes d'abord. */
export async function listRuns() {
  const runs = await prisma.opsPayRun.findMany({ orderBy: { period: 'desc' }, take: 60 })
  return runs.map(r => ({
    period: r.period, status: r.status as RunStatus, locked: r.status !== 'draft', totals: parseJson<RunTotals>(r.totals), note: r.note,
    createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), validatedBy: r.validatedBy, validatedAt: iso(r.validatedAt), paidBy: r.paidBy, paidAt: iso(r.paidAt),
  }))
}

/** Crée ou recalcule le brouillon (interdit si validé/payé). Conserve les ajustements déjà saisis. Fige barème et tarifs. */
export async function createOrRefreshDraft(period: string, by: string): Promise<RunView> {
  const existing = await prisma.opsPayRun.findUnique({ where: { period } })
  const t = nextStatus((existing?.status as RunStatus | undefined) ?? null, 'draft')
  if (!t.ok) throw new RunError(t.error)
  const { cfg, lines } = await buildRunLines(period)
  const { id: _id, ...cfgSnap } = cfg; void _id
  const snapshot = JSON.stringify({ config: cfgSnap, rates: Object.fromEntries(lines.map(l => [l.code, l.dailyRate])), computedAt: new Date().toISOString() })
  const run = existing
    ? await prisma.opsPayRun.update({ where: { period }, data: { config: snapshot } })
    : await prisma.opsPayRun.create({ data: { period, status: 'draft', config: snapshot, createdBy: by } })
  const old = await prisma.opsPayRunLine.findMany({ where: { runId: run.id }, select: { driverCode: true, adjustment: true, adjustmentNote: true } })
  const adj = new Map(old.map(o => [o.driverCode, o]))
  const data = lines.map(l => {
    const a = adj.get(l.code)
    const adjustment = a?.adjustment ?? 0
    return { runId: run.id, driverCode: l.code, driverName: l.name, jobType: l.jobType, hubCode: l.hubCode, dailyRate: l.dailyRate, paidDays: l.paidDays, daysLate: l.daysLate, daysAbsent: l.daysAbsent, daysLeave: l.daysLeave,
      delivered: l.delivered, onTime: l.onTime, deliveredLate: l.deliveredLate, noShow: l.noShow, bonusOrders: l.bonusOrders, gross: l.gross, bonus: l.bonus, deductions: l.deductions, net: l.net,
      adjustment, adjustmentNote: a?.adjustmentNote ?? null, final: finalOf(l.net, adjustment) }
  })
  // remplacement atomique des lignes du brouillon
  await prisma.$transaction([prisma.opsPayRunLine.deleteMany({ where: { runId: run.id } }), prisma.opsPayRunLine.createMany({ data })])
  return (await getRun(period)) as RunView
}

/** Charge la clôture et vérifie la transition ; erreur claire sinon. */
async function transition(period: string, action: 'validate' | 'paid' | 'reopen') {
  const run = await prisma.opsPayRun.findUnique({ where: { period } })
  const t = nextStatus((run?.status as RunStatus | undefined) ?? null, action)
  if (!t.ok || !run) throw new RunError(t.ok ? 'Aucune clôture pour ce mois.' : t.error, run ? 409 : 404)
  return { run, to: t.to }
}

/** draft -> validated : fige validatedBy/At et les totaux (dont le montant final réellement dû). */
export async function validateRun(period: string, by: string): Promise<RunView> {
  const { run } = await transition(period, 'validate')
  const lines = await prisma.opsPayRunLine.findMany({ where: { runId: run.id } })
  if (!lines.length) throw new RunError('Brouillon vide : aucune ligne à valider.')
  const totals = totalsOf(lines)
  // garde de concurrence : ne valide que si le statut est encore « draft »
  const r = await prisma.opsPayRun.updateMany({ where: { id: run.id, status: 'draft' }, data: { status: 'validated', validatedBy: by, validatedAt: new Date(), totals: JSON.stringify(totals) } })
  if (r.count !== 1) throw new RunError('La clôture a changé entre-temps, rechargez la page.')
  return (await getRun(period)) as RunView
}

/** validated -> paid. */
export async function markPaid(period: string, by: string): Promise<RunView> {
  const { run } = await transition(period, 'paid')
  const r = await prisma.opsPayRun.updateMany({ where: { id: run.id, status: 'validated' }, data: { status: 'paid', paidBy: by, paidAt: new Date() } })
  if (r.count !== 1) throw new RunError('La clôture a changé entre-temps, rechargez la page.')
  return (await getRun(period)) as RunView
}

/** validated -> draft (ADMIN) : motif obligatoire, conservé dans la note de la clôture. */
export async function reopenRun(period: string, by: string, reason: string): Promise<RunView> {
  const why = (reason || '').trim().slice(0, 300)
  if (why.length < 5) throw new RunError('Motif de réouverture obligatoire (5 caractères minimum).', 400)
  const { run } = await transition(period, 'reopen')
  const stamp = `${new Date().toISOString().slice(0, 10)} · rouverte par ${by} : ${why}`
  const r = await prisma.opsPayRun.updateMany({ where: { id: run.id, status: 'validated' }, data: { status: 'draft', validatedBy: null, validatedAt: null, totals: null, note: [run.note, stamp].filter(Boolean).join('\n').slice(-1500) } })
  if (r.count !== 1) throw new RunError('La clôture a changé entre-temps, rechargez la page.')
  return (await getRun(period)) as RunView
}

/** Ajustement manuel ± sur une ligne (brouillon uniquement) : final = net + ajustement. */
export async function setAdjustment(period: string, driverCode: string, amount: unknown, note: unknown): Promise<RunView> {
  const run = await prisma.opsPayRun.findUnique({ where: { period } })
  const t = nextStatus((run?.status as RunStatus | undefined) ?? null, 'adjust')
  if (!t.ok || !run) throw new RunError(t.ok ? 'Aucune clôture pour ce mois.' : t.error)
  const c = checkAdjustment(amount, note)
  if (!c.ok) throw new RunError(c.error, 400)
  const line = await prisma.opsPayRunLine.findUnique({ where: { runId_driverCode: { runId: run.id, driverCode } } })
  if (!line) throw new RunError('Livreur absent de cette clôture.', 404)
  await prisma.opsPayRunLine.update({ where: { id: line.id }, data: { adjustment: c.amount, adjustmentNote: c.note, final: finalOf(line.net, c.amount) } })
  return (await getRun(period)) as RunView
}

/** CSV (puis xlsx) d'une clôture figée : inclut ajustements et montant final. */
export function runCsv(v: RunView): string {
  const n = (x: number) => String(x).replace('.', ',')
  const head = ['Livreur', 'Code', 'Hub', 'Période', 'Statut', 'Tarif/jour', 'Jours payés', 'Retards (jours)', 'Absences', 'Congés', 'Livrées', 'Dans le créneau', 'Hors créneau', 'NO_SHOW', 'Cmd bonus', 'Brut', 'Bonus', 'Retenues', 'Net calculé', 'Ajustement', 'Note ajustement', 'Net final à payer']
  const rows = v.lines.map(l => [l.name, l.code, l.hubCode ?? '', v.period, v.status, n(l.dailyRate), l.paidDays, l.daysLate, l.daysAbsent, l.daysLeave, l.delivered, l.onTime, l.deliveredLate, l.noShow, l.bonusOrders, n(l.gross), n(l.bonus), n(l.deductions), n(l.net), n(l.adjustment), l.adjustmentNote ?? '', n(l.final)])
  const t = v.totals
  const total = ['TOTAL', '', '', v.period, v.status, '', '', '', '', '', t.delivered, '', '', '', '', n(t.gross), n(t.bonus), n(t.deductions), n(t.net), n(t.adjustments), '', n(t.final)]
  return '﻿' + [head, ...rows, total].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
}
