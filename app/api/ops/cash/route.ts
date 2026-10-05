import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'

const HOUR = 3_600_000

// GET /api/ops/cash?hub=&driver= — commandes LIVRÉES dont le montant n'a pas encore été encaissé (paiement à la livraison)
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const hub = sp.get('hub') || undefined, driver = sp.get('driver') || undefined
    const now = Date.now()
    const pendingWhere = { status: 'DELIVERED', collectedAt: null, amount: { gt: 0 }, ...(hub ? { hubCode: hub } : {}), ...(driver ? { driver: { code: driver } } : {}) }
    const [pending, recent, todayCollected] = await Promise.all([
      prisma.opsOrder.findMany({
        where: pendingWhere, orderBy: { deliveredAt: 'asc' }, take: 1500,
        select: { id: true, externalId: true, reference: true, hubCode: true, slotLabel: true, district: true, customerName: true, amount: true, deliveredAt: true, driver: { select: { code: true, firstName: true, lastName: true } } },
      }),
      prisma.opsOrder.findMany({
        where: { collectedAt: { not: null }, ...(hub ? { hubCode: hub } : {}) }, orderBy: { collectedAt: 'desc' }, take: 15,
        select: { id: true, externalId: true, reference: true, hubCode: true, collectedAmount: true, collectedAt: true, collectedBy: true, collectionMethod: true, driver: { select: { firstName: true, lastName: true } } },
      }),
      prisma.opsOrder.aggregate({ where: { collectedAt: { gte: new Date(new Date(now + HOUR).toISOString().slice(0, 10) + 'T00:00:00Z') } }, _sum: { collectedAmount: true }, _count: { _all: true } }),
    ])
    const rows = pending.map(o => ({
      id: o.id, ref: o.reference || o.externalId, hubCode: o.hubCode, slot: o.slotLabel, district: o.district, customer: o.customerName, amount: o.amount ?? 0, deliveredAt: o.deliveredAt,
      ageHours: o.deliveredAt ? Math.round(((now - o.deliveredAt.getTime()) / HOUR) * 10) / 10 : 0,
      driverCode: o.driver?.code ?? '—', driverName: o.driver ? `${o.driver.firstName} ${o.driver.lastName}` : 'Non affecté',
    }))
    const by = new Map<string, { code: string; name: string; count: number; total: number; oldest: number }>()
    for (const r of rows) { const g = by.get(r.driverCode) ?? { code: r.driverCode, name: r.driverName, count: 0, total: 0, oldest: 0 }; g.count++; g.total += r.amount; g.oldest = Math.max(g.oldest, r.ageHours); by.set(r.driverCode, g) }
    return NextResponse.json({
      canCollect: ['DISPATCHER', 'COORDINATOR', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(auth.session.role),
      totals: { count: rows.length, total: Math.round(rows.reduce((s, r) => s + r.amount, 0)), over24h: rows.filter(r => r.ageHours > 24).length, over48h: rows.filter(r => r.ageHours > 48).length, collectedToday: todayCollected._count._all, collectedTodayAmount: Math.round(todayCollected._sum.collectedAmount ?? 0) },
      byDriver: [...by.values()].sort((a, b) => b.oldest - a.oldest), orders: rows,
      recent: recent.map(r => ({ id: r.id, ref: r.reference || r.externalId, hubCode: r.hubCode, amount: r.collectedAmount, at: r.collectedAt, by: r.collectedBy, method: r.collectionMethod, driver: r.driver ? `${r.driver.firstName} ${r.driver.lastName}` : null })),
    })
  } catch (e) { return fail(e) }
}

// POST /api/ops/cash
//   { action:'collect', orderIds:[…], method?: 'especes'|'carte'|'virement', note? }   encaisse (montant = montant de la commande) → la commande rejoint l'Historique
//   { action:'revert', orderIds:[…] }                                                  annule un encaissement (manager)
export async function POST(req: NextRequest) {
  const b0 = await req.clone().json().catch(() => ({})) as { action?: string }
  const auth = await opsAuth(req, b0.action === 'revert' ? 'MANAGER' : 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as { action: string; orderIds: string[]; method?: string; note?: string }
    if (!Array.isArray(b.orderIds) || !b.orderIds.length) return NextResponse.json({ error: 'Aucune commande sélectionnée' }, { status: 400 })
    const who = auth.session.name || auth.session.email; const now = new Date()

    if (b.action === 'collect') {
      const method = ['especes', 'carte', 'virement'].includes(String(b.method)) ? String(b.method) : 'especes'
      const orders = await prisma.opsOrder.findMany({ where: { id: { in: b.orderIds }, status: 'DELIVERED', collectedAt: null }, select: { id: true, amount: true, hubCode: true } })
      if (!orders.length) return NextResponse.json({ error: 'Aucune commande livrée et non encaissée dans la sélection' }, { status: 409 })
      for (let i = 0; i < orders.length; i += 50) {
        const part = orders.slice(i, i + 50)
        await prisma.$transaction([
          ...part.map(o => prisma.opsOrder.update({ where: { id: o.id }, data: { collectedAt: now, collectedAmount: o.amount ?? 0, collectedBy: who, collectionMethod: method, collectionNote: b.note ?? null } })),
          prisma.opsOrderEvent.createMany({ data: part.map(o => ({ orderId: o.id, fromStatus: 'DELIVERED', toStatus: 'COLLECTED', at: now, source: 'cash' })) }),
        ])
      }
      const total = Math.round(orders.reduce((s, o) => s + (o.amount ?? 0), 0))
      await audit(auth.session, 'cash.collect', 'order', orders.length === 1 ? orders[0].id : null, { count: orders.length, total, method }, orders[0].hubCode)
      return NextResponse.json({ ok: true, collected: orders.length, total })
    }

    if (b.action === 'revert') {
      const r = await prisma.opsOrder.updateMany({ where: { id: { in: b.orderIds }, collectedAt: { not: null } }, data: { collectedAt: null, collectedAmount: null, collectedBy: null, collectionMethod: null, collectionNote: null } })
      await audit(auth.session, 'cash.revert', 'order', null, { count: r.count })
      return NextResponse.json({ ok: true, reverted: r.count })
    }
    return NextResponse.json({ error: 'action invalide' }, { status: 400 })
  } catch (e) { return fail(e) }
}
