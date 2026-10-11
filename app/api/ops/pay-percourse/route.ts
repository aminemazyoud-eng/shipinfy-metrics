import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { dayBoundsTz, addDays, localToday } from '@/lib/tz'
import { isOnTime } from '@/lib/ops-defs'
import { xlsxResponse } from '@/lib/xlsx-response'

const r2 = (n: number) => Math.round(n * 100) / 100
const DEFAULTS: Record<string, { baseRate: number; bonusRate: number; penaltyRate: number }> = {
  standard: { baseRate: 15, bonusRate: 5, penaltyRate: 5 },
  express: { baseRate: 25, bonusRate: 10, penaltyRate: 10 },
}

// GET /api/ops/pay-percourse?from=&to=&mode=standard|express[&format=xlsx]
//   Rémunération « à la course » (tarif PayConfig standard/express) calculée sur les commandes TEMPS RÉEL (OpsOrder),
//   en remplacement de l'ancien calcul sur rapports importés (/api/remuneration/calculate).
// GET /api/ops/pay-percourse?history=CODE — 6 derniers mois d'un livreur (livrées, taux, encaissé, statut de la clôture du mois).
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const hist = sp.get('history')
    if (hist) {
      const drv = await prisma.opsDriver.findUnique({ where: { code: hist }, select: { id: true, code: true, firstName: true, lastName: true } })
      if (!drv) return NextResponse.json({ history: [] })
      const today = localToday()
      const out: { period: string; total: number; delivered: number; deliveryRate: number; collected: number; payStatus: string | null }[] = []
      for (let i = 0; i < 6; i++) {
        const first = addDays(today.slice(0, 8) + '01', -30 * i).slice(0, 7) + '-01'
        const nextFirst = addDays(first.slice(0, 7) + '-28', 5).slice(0, 8) + '01'
        const b = { from: dayBoundsTz(first).from, to: dayBoundsTz(nextFirst).from }
        const orders = await prisma.opsOrder.findMany({ where: { driverId: drv.id, slotStart: { gte: b.from, lt: b.to } }, select: { status: true, collectedAmount: true } })
        const run = await prisma.opsPayRun.findUnique({ where: { period: first.slice(0, 7) }, select: { status: true } }).catch(() => null)
        const delivered = orders.filter(o => o.status === 'DELIVERED').length
        out.push({ period: first.slice(0, 7), total: orders.length, delivered, deliveryRate: orders.length ? r2(delivered / orders.length * 100) : 0, collected: r2(orders.reduce((s, o) => s + (o.collectedAmount ?? 0), 0)), payStatus: run?.status ?? null })
      }
      return NextResponse.json({ driver: `${drv.firstName} ${drv.lastName}`, history: out.filter(h => h.total > 0) })
    }

    const today = localToday()
    const from = sp.get('from') || today.slice(0, 8) + '01'
    const to = sp.get('to') || today
    const mode = sp.get('mode') === 'express' ? 'express' : 'standard'
    const cfgRow = await prisma.payConfig.findUnique({ where: { mode } })
    const cfg = cfgRow ?? { ...DEFAULTS[mode] }
    const range = { gte: dayBoundsTz(from).from, lt: dayBoundsTz(addDays(to, 1)).from }
    const orders = await prisma.opsOrder.findMany({
      where: { slotStart: range, status: { not: 'CANCELLED' } },
      select: { status: true, slotEnd: true, deliveredAt: true, driverId: true, courierRef: true, driver: { select: { code: true, firstName: true, lastName: true } } },
    })
    const map = new Map<string, { code: string; driverName: string; total: number; deliveries: number; onTime: number; noShows: number }>()
    for (const o of orders) {
      if (!o.driverId && !o.courierRef) continue // non assignée : on ne rémunère personne
      const code = o.driver?.code ?? o.courierRef ?? '?'
      const name = o.driver ? `${o.driver.firstName} ${o.driver.lastName}`.trim() : code
      const l = map.get(code) ?? { code, driverName: name, total: 0, deliveries: 0, onTime: 0, noShows: 0 }
      l.total++
      if (o.status === 'DELIVERED') { l.deliveries++; if (isOnTime({ status: o.status, slotEnd: o.slotEnd, deliveredAt: o.deliveredAt })) l.onTime++ }
      if (o.status === 'NO_SHOW') l.noShows++
      map.set(code, l)
    }
    const drivers = [...map.values()].map(l => {
      const grossPay = r2(l.deliveries * cfg.baseRate), bonus = r2(l.onTime * cfg.bonusRate), penalty = r2(l.noShows * cfg.penaltyRate)
      return { ...l, grossPay, bonus, penalty, netPay: r2(grossPay + bonus - penalty) }
    }).sort((a, b) => b.netPay - a.netPay)
    const sum = (k: 'grossPay' | 'bonus' | 'penalty' | 'netPay') => r2(drivers.reduce((s, d) => s + d[k], 0))
    const totals = { grossPay: sum('grossPay'), bonus: sum('bonus'), penalty: sum('penalty'), netPay: sum('netPay') }

    if (sp.get('format') === 'xlsx') {
      const n = (v: number) => String(v).replace('.', ',')
      const head = ['Livreur', 'Code', 'Total', 'Livrées', 'Dans le créneau', 'NO_SHOW', 'Brut', 'Bonus', 'Pénalité', 'Net']
      const rows = drivers.map(d => [d.driverName, d.code, d.total, d.deliveries, d.onTime, d.noShows, n(d.grossPay), n(d.bonus), n(d.penalty), n(d.netPay)])
      const csv = '﻿' + [head, ...rows, ['TOTAL', '', '', '', '', '', n(totals.grossPay), n(totals.bonus), n(totals.penalty), n(totals.netPay)]].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
      return xlsxResponse(csv, `remuneration_course_${mode}_${from}_${to}`, 'Rémunération')
    }
    return NextResponse.json({ from, to, mode, config: { baseRate: cfg.baseRate, bonusRate: cfg.bonusRate, penaltyRate: cfg.penaltyRate }, drivers, totals })
  } catch (e) { return fail(e) }
}
