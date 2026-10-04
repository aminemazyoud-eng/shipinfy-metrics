import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { dayOf, dayBounds, attendanceKey } from '@/lib/ops-time'
import { computePay, payCsv, type PayConfig } from '@/lib/ops-pay'

const TZ = 3_600_000
const localDay = (d: Date) => new Date(d.getTime() + TZ).toISOString().slice(0, 10)

async function getConfig(): Promise<PayConfig & { id: string }> {
  return prisma.opsPayConfig.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } })
}

// GET /api/ops/pay?from=YYYY-MM-DD&to=YYYY-MM-DD&hub=&format=csv   (défaut : mois en cours)
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const today = dayOf('today')
    const from = sp.get('from') || today.slice(0, 8) + '01'
    const to = sp.get('to') || today
    const hub = sp.get('hub') || undefined
    const start = dayBounds(from).from, end = dayBounds(to).to
    const cfg = await getConfig()

    const drivers = await prisma.opsDriver.findMany({ where: { status: { not: 'off' }, ...(hub ? { hub: { code: hub } } : {}) }, include: { hub: { select: { code: true } } }, orderBy: { code: 'asc' } })
    const ids = drivers.map(d => d.id)
    const byName = new Map(drivers.map(d => [`${d.firstName} ${d.lastName}`, d]))
    const [att, orders] = await Promise.all([
      prisma.driverAttendance.findMany({ where: { driverName: { in: drivers.map(d => `${d.firstName} ${d.lastName}`) }, date: { gte: attendanceKey(from), lte: attendanceKey(to) } }, select: { driverName: true, date: true, status: true } }),
      prisma.opsOrder.findMany({ where: { driverId: { in: ids }, OR: [{ status: 'DELIVERED', deliveredAt: { gte: start, lt: end } }, { status: 'NO_SHOW', noShowAt: { gte: start, lt: end } }] }, select: { driverId: true, status: true, deliveredAt: true, noShowAt: true, slotEnd: true } }),
    ])
    const lines = computePay(cfg, drivers.map(d => ({ id: d.id, code: d.code, name: `${d.firstName} ${d.lastName}`, hubCode: d.hub?.code ?? null, dailyRate: d.dailyRate })),
      att.flatMap(a => { const d = byName.get(a.driverName); return d ? [{ driverId: d.id, day: a.date.toISOString().slice(0, 10), status: a.status }] : [] }),
      orders.map(o => { const at = (o.deliveredAt ?? o.noShowAt) as Date; return { driverId: o.driverId as string, day: localDay(at), status: o.status, onTime: o.status === 'DELIVERED' && at <= o.slotEnd } }))

    if (sp.get('format') === 'csv') {
      return new NextResponse(payCsv(lines, `${from} → ${to}`), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="paie_livreurs_${from}_${to}.csv"` } })
    }
    const sum = (k: 'gross' | 'bonus' | 'deductions' | 'net') => Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100
    return NextResponse.json({ from, to, config: cfg, lines, totals: { gross: sum('gross'), bonus: sum('bonus'), deductions: sum('deductions'), net: sum('net'), delivered: lines.reduce((s, l) => s + l.delivered, 0) } })
  } catch (e) { return fail(e) }
}

// PUT /api/ops/pay — modifie la configuration de paie ; applyToAll=true propage le tarif journalier à tous les livreurs
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
        onTimeBonus: num(b.onTimeBonus, cur.onTimeBonus), noShowPenalty: num(b.noShowPenalty, cur.noShowPenalty), latePenalty: num(b.latePenalty, cur.latePenalty), paidLeave: b.paidLeave ?? cur.paidLeave },
    })
    if (b.applyToAll) await prisma.opsDriver.updateMany({ data: { dailyRate: next.dailyRate } })
    await audit(auth.session, 'pay.config', 'config', 'default', { before: cur, after: next, applyToAll: !!b.applyToAll })
    return NextResponse.json({ ok: true, config: next })
  } catch (e) { return fail(e) }
}
