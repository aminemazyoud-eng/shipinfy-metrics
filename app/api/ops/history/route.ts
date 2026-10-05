import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
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

    // Commandes TERMINÉES = livrées ET encaissées (fin de parcours)
    if (sp.get('view') === 'done') {
      const driver = sp.get('driver') || undefined, q = sp.get('q')?.trim(), offset = Number(sp.get('offset')) || 0
      const where: Prisma.OpsOrderWhereInput = {
        collectedAt: { gte: dayBounds(from).from, lt: dayBounds(to).to }, ...(hub ? { hubCode: hub } : {}), ...(driver ? { driver: { code: driver } } : {}),
        ...(q ? { OR: [{ reference: { contains: q } }, { externalId: { contains: q } }, { customerName: { contains: q, mode: 'insensitive' } }, { district: { contains: q, mode: 'insensitive' } }, { driver: { firstName: { contains: q, mode: 'insensitive' } } }, { driver: { lastName: { contains: q, mode: 'insensitive' } } }] } : {}),
      }
      const [rows, agg] = await Promise.all([
        prisma.opsOrder.findMany({ where, orderBy: { collectedAt: 'desc' }, take: sp.get('format') === 'csv' ? 20000 : 100, skip: sp.get('format') === 'csv' ? 0 : offset,
          select: { id: true, externalId: true, reference: true, hubCode: true, slotLabel: true, slotEnd: true, district: true, customerName: true, collectedAmount: true, deliveredAt: true, collectedAt: true, collectedBy: true, collectionMethod: true, driver: { select: { firstName: true, lastName: true } } } }),
        prisma.opsOrder.aggregate({ where, _count: { _all: true }, _sum: { collectedAmount: true } }),
      ])
      const out = rows.map(r => ({ id: r.id, ref: r.reference || r.externalId, hubCode: r.hubCode, slot: r.slotLabel, district: r.district, customer: r.customerName, driver: r.driver ? `${r.driver.firstName} ${r.driver.lastName}` : null,
        amount: r.collectedAmount ?? 0, deliveredAt: r.deliveredAt, collectedAt: r.collectedAt, collectedBy: r.collectedBy, method: r.collectionMethod, onTime: r.deliveredAt ? r.deliveredAt <= r.slotEnd : null }))
      if (sp.get('format') === 'csv') {
        const head = ['Référence', 'Hub', 'Créneau', 'Livreur', 'Client', 'Quartier', 'Livrée le', 'Encaissée le', 'Encaissée par', 'Mode', 'Montant (MAD)']
        const iso = (d: Date | null) => (d ? d.toISOString().replace('T', ' ').slice(0, 16) : '')
        const lines = [head, ...rows.map((r, i) => [out[i].ref, r.hubCode ?? '', r.slotLabel ?? '', out[i].driver ?? '', r.customerName ?? '', r.district ?? '', iso(r.deliveredAt), iso(r.collectedAt), r.collectedBy ?? '', r.collectionMethod ?? '', String(r.collectedAmount ?? 0).replace('.', ',')])]
        return new NextResponse('\uFEFF' + lines.map(l => l.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="commandes_terminees_${from}_${to}.csv"` } })
      }
      return NextResponse.json({ from, to, offset, total: agg._count._all, amount: agg._sum.collectedAmount ?? 0, rows: out })
    }
    const rows = await prisma.opsOrder.findMany({
      where: { slotStart: { gte: dayBounds(from).from, lt: dayBounds(to).to }, ...(hub ? { hubCode: hub } : {}) },
      select: { slotStart: true, slotEnd: true, status: true, hubCode: true, createdAtSrc: true, deliveredAt: true, noShowAt: true, amount: true, driver: { select: { code: true } } },
    })
    const h = buildHistory(rows.map(r => ({ slotStart: r.slotStart, slotEnd: r.slotEnd, status: r.status, hubCode: r.hubCode, driverCode: r.driver?.code ?? null, createdAt: r.createdAtSrc, deliveredAt: r.deliveredAt, noShowAt: r.noShowAt, amount: r.amount })))
    if (sp.get('format') === 'csv') return new NextResponse(historyCsv(h), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="historique_${from}_${to}.csv"` } })
    return NextResponse.json({ from, to, ...h })
  } catch (e) { return fail(e) }
}
