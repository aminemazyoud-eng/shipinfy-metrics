import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { dayOf, dayBounds } from '@/lib/ops-time'
import { buildHistory, historyCsv } from '@/lib/ops-history'

// GET /api/ops/history?from=&to=&hub=&format=csv — historique agrégé (défaut : 30 derniers jours) + journal d'actions
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const to = sp.get('to') || dayOf('today')
    const from = sp.get('from') || dayOf('-30')
    const hub = sp.get('hub') || undefined
    const rows = await prisma.opsOrder.findMany({
      where: { slotStart: { gte: dayBounds(from).from, lt: dayBounds(to).to }, ...(hub ? { hubCode: hub } : {}) },
      select: { slotStart: true, slotEnd: true, status: true, hubCode: true, createdAtSrc: true, deliveredAt: true, noShowAt: true, amount: true, driver: { select: { code: true } } },
    })
    const h = buildHistory(rows.map(r => ({ slotStart: r.slotStart, slotEnd: r.slotEnd, status: r.status, hubCode: r.hubCode, driverCode: r.driver?.code ?? null, createdAt: r.createdAtSrc, deliveredAt: r.deliveredAt, noShowAt: r.noShowAt, amount: r.amount })))
    if (sp.get('format') === 'csv') return new NextResponse(historyCsv(h), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="historique_${from}_${to}.csv"` } })
    const log = await prisma.opsAuditLog.findMany({ orderBy: { at: 'desc' }, take: 40 })
    return NextResponse.json({ from, to, ...h, log: log.map(l => ({ at: l.at, actor: l.actor, action: l.action, entity: l.entity, entityId: l.entityId, hubCode: l.hubCode, payload: l.payload })) })
  } catch (e) { return fail(e) }
}
