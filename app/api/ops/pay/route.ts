import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { dayOf } from '@/lib/ops-time'
import { payCsv, type PayConfig } from '@/lib/ops-pay'
import { xlsxResponse } from '@/lib/xlsx-response'
import { computeRange, getRun } from '@/lib/ops-payrun'

async function getConfig(): Promise<PayConfig & { id: string }> {
  return prisma.opsPayConfig.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } })
}

const r2 = (n: number) => Math.round(n * 100) / 100

// GET /api/ops/pay?from=YYYY-MM-DD&to=YYYY-MM-DD&hub=&format=csv   (défaut : mois en cours)
// Si la plage est dans UN mois dont la paie est validée/payée : renvoie les lignes FIGÉES (locked:true), jamais un recalcul.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const today = dayOf('today')
    const from = sp.get('from') || today.slice(0, 8) + '01'
    const to = sp.get('to') || today
    const hub = sp.get('hub') || undefined

    // mois clôturé : lecture des lignes enregistrées (tarifs et jours figés)
    if (from.slice(0, 7) === to.slice(0, 7)) {
      const run = await getRun(from.slice(0, 7))
      if (run && run.locked) {
        const lines = run.lines.filter(l => !hub || l.hubCode === hub)
        if (sp.get('format') === 'xlsx') return xlsxResponse(payCsv(lines.map(l => ({ ...l, net: l.final })), `${run.period} (clôturé ${run.status})`), `paie_livreurs_${run.period}_fige`, 'Paie')
        const sum = (k: 'gross' | 'bonus' | 'deductions' | 'net' | 'final') => r2(lines.reduce((s, l) => s + l[k], 0))
        return NextResponse.json({
          from, to, period: run.period, locked: true, status: run.status, config: run.config ?? await getConfig(), lines,
          totals: { gross: sum('gross'), bonus: sum('bonus'), deductions: sum('deductions'), net: sum('final'), computedNet: sum('net'), adjustments: r2(lines.reduce((s, l) => s + l.adjustment, 0)), delivered: lines.reduce((s, l) => s + l.delivered, 0) },
          validatedBy: run.validatedBy, validatedAt: run.validatedAt,
          message: 'Mois clôturé : valeurs figées (tarifs et jours du jour de la validation), plage affichée = mois entier.',
        })
      }
    }

    const { cfg, lines } = await computeRange(from, to, hub)
    if (sp.get('format') === 'xlsx') {
      return xlsxResponse(payCsv(lines, `${from} → ${to}`), `paie_livreurs_${from}_${to}`, 'Paie')
    }
    const sum = (k: 'gross' | 'bonus' | 'deductions' | 'net') => r2(lines.reduce((s, l) => s + l[k], 0))
    return NextResponse.json({ from, to, locked: false, status: null, config: cfg, lines, totals: { gross: sum('gross'), bonus: sum('bonus'), deductions: sum('deductions'), net: sum('net'), delivered: lines.reduce((s, l) => s + l.delivered, 0) } })
  } catch (e) { return fail(e) }
}

// PUT /api/ops/pay — modifie la configuration de paie ; applyToAll=true propage le tarif journalier à tous les livreurs.
// Ne touche JAMAIS un mois clôturé : seuls les tarifs courants (calculs futurs / brouillons recalculés) changent.
export async function PUT(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as Partial<PayConfig> & { applyToAll?: boolean }
    const num = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 ? v : d)
    const cur = await getConfig()
    const next = await prisma.opsPayConfig.update({
      where: { id: 'default' },
      data: { dailyRate: num(b.dailyRate, cur.dailyRate), bonusThreshold: Math.round(num(b.bonusThreshold, cur.bonusThreshold)), bonusPerOrder: num(b.bonusPerOrder, cur.bonusPerOrder),
        onTimeBonus: num(b.onTimeBonus, cur.onTimeBonus), helperDailyRate: num(b.helperDailyRate, cur.helperDailyRate), noShowPenalty: num(b.noShowPenalty, cur.noShowPenalty), latePenalty: num(b.latePenalty, cur.latePenalty), paidLeave: b.paidLeave ?? cur.paidLeave },
    })
    if (b.applyToAll) { await prisma.opsDriver.updateMany({ where: { jobType: 'chauffeur' }, data: { dailyRate: next.dailyRate } }); await prisma.opsDriver.updateMany({ where: { jobType: 'helper' }, data: { dailyRate: next.helperDailyRate } }) }
    await audit(auth.session, 'pay.config', 'config', 'default', { before: cur, after: next, applyToAll: !!b.applyToAll })
    const locked = await prisma.opsPayRun.findMany({ where: { status: { in: ['validated', 'paid'] } }, select: { period: true } })
    return NextResponse.json({
      ok: true, config: next, lockedPeriodsUntouched: locked.map(l => l.period),
      note: 'Les nouveaux tarifs ne s’appliquent qu’aux calculs futurs et aux brouillons recalculés : les mois validés/payés restent figés.',
    })
  } catch (e) { return fail(e) }
}
