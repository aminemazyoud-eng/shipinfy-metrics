import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { ACTIVE_SOURCE } from '@/lib/ops-data'
import { dayBoundsTz, localDay } from '@/lib/tz'
import { bumpOpsEpoch } from '@/lib/ops-cache'

const HOUR = 3_600_000
const LIST_MAX = 1500 // lignes affichées ; les totaux, eux, sont calculés sur TOUTES les commandes (aggregate / groupBy)

// GET /api/ops/cash?hub=&driver= — commandes LIVRÉES dont le montant n'a pas encore été encaissé (paiement à la livraison)
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const hub = sp.get('hub') || undefined, driver = sp.get('driver') || undefined
    const now = Date.now()
    const scope = { source: ACTIVE_SOURCE, ...(hub ? { hubCode: hub } : {}), ...(driver ? { driver: { code: driver } } : {}) }
    const pendingWhere: Prisma.OpsOrderWhereInput = { ...scope, status: 'DELIVERED', collectedAt: null, amount: { gt: 0 } }
    const ago = (h: number) => new Date(now - h * HOUR)
    const todayFrom = dayBoundsTz(localDay(now)).from // début du jour local réel (Ramadan inclus)

    const [pending, recent, todayCollected, agg, over24, over48, groups, noAmount] = await Promise.all([
      prisma.opsOrder.findMany({
        where: pendingWhere, orderBy: { deliveredAt: 'asc' }, take: LIST_MAX,
        select: { id: true, externalId: true, reference: true, hubCode: true, slotLabel: true, district: true, customerName: true, amount: true, deliveredAt: true, driver: { select: { code: true, firstName: true, lastName: true } } },
      }),
      prisma.opsOrder.findMany({
        where: { source: ACTIVE_SOURCE, collectedAt: { not: null }, ...(hub ? { hubCode: hub } : {}) }, orderBy: { collectedAt: 'desc' }, take: 15,
        select: { id: true, externalId: true, reference: true, hubCode: true, collectedAmount: true, collectedAt: true, collectedBy: true, collectionMethod: true, driver: { select: { firstName: true, lastName: true } } },
      }),
      prisma.opsOrder.aggregate({ where: { source: ACTIVE_SOURCE, collectedAt: { gte: todayFrom } }, _sum: { collectedAmount: true }, _count: { _all: true } }),
      // totaux sur l'ensemble des commandes à encaisser (et non sur les 1 500 premières lignes)
      prisma.opsOrder.aggregate({ where: pendingWhere, _sum: { amount: true }, _count: { _all: true } }),
      prisma.opsOrder.count({ where: { ...pendingWhere, deliveredAt: { lt: ago(24) } } }),
      prisma.opsOrder.count({ where: { ...pendingWhere, deliveredAt: { lt: ago(48) } } }),
      prisma.opsOrder.groupBy({ by: ['driverId'], where: pendingWhere, _count: { _all: true }, _sum: { amount: true }, _min: { deliveredAt: true } }),
      // livrées sans montant : rien à encaisser, mais visibles (Historique, indicateur noCollection)
      prisma.opsOrder.count({ where: { ...scope, status: 'DELIVERED', collectedAt: null, OR: [{ amount: null }, { amount: { lte: 0 } }] } }),
    ])
    const rows = pending.map(o => ({
      id: o.id, ref: o.reference || o.externalId, hubCode: o.hubCode, slot: o.slotLabel, district: o.district, customer: o.customerName, amount: o.amount ?? 0, deliveredAt: o.deliveredAt,
      ageHours: o.deliveredAt ? Math.round(((now - o.deliveredAt.getTime()) / HOUR) * 10) / 10 : 0,
      driverCode: o.driver?.code ?? '—', driverName: o.driver ? `${o.driver.firstName} ${o.driver.lastName}` : 'Non affecté',
    }))

    // regroupement par livreur sur l'ensemble (groupBy), noms résolus en une requête
    const ids = groups.map(g => g.driverId).filter((x): x is string => !!x)
    const drv = ids.length ? await prisma.opsDriver.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, firstName: true, lastName: true } }) : []
    const drvBy = new Map(drv.map(d => [d.id, d]))
    const byDriver = groups.map(g => {
      const d = g.driverId ? drvBy.get(g.driverId) : undefined
      const oldest = g._min.deliveredAt ? Math.round(((now - g._min.deliveredAt.getTime()) / HOUR) * 10) / 10 : 0
      return { code: d?.code ?? '—', name: d ? `${d.firstName} ${d.lastName}` : 'Non affecté', count: g._count._all, total: g._sum.amount ?? 0, oldest }
    }).sort((a, b) => b.oldest - a.oldest)

    return NextResponse.json({
      canCollect: ['DISPATCHER', 'COORDINATOR', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(auth.session.role),
      totals: { count: agg._count._all, total: Math.round(agg._sum.amount ?? 0), over24h: over24, over48h: over48, noAmount, collectedToday: todayCollected._count._all, collectedTodayAmount: Math.round(todayCollected._sum.collectedAmount ?? 0) },
      truncated: agg._count._all > rows.length,
      byDriver, orders: rows,
      recent: recent.map(r => ({ id: r.id, ref: r.reference || r.externalId, hubCode: r.hubCode, amount: r.collectedAmount, at: r.collectedAt, by: r.collectedBy, method: r.collectionMethod, driver: r.driver ? `${r.driver.firstName} ${r.driver.lastName}` : null })),
    })
  } catch (e) { return fail(e) }
}

// POST /api/ops/cash
//   { action:'collect', orderIds:[…], method?: 'especes'|'carte'|'virement', note? }   encaisse (montant = montant de la commande) → la commande rejoint l'Historique
//   { action:'revert', orderIds:[…] }                                                  annule un encaissement (manager)
// Sprint 17 B3 : UPDATE conditionnel atomique + RETURNING → deux « encaisser » simultanés = un seul événement COLLECTED.
export async function POST(req: NextRequest) {
  const b0 = await req.clone().json().catch(() => ({})) as { action?: string }
  const auth = await opsAuth(req, b0.action === 'revert' ? 'MANAGER' : 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as { action: string; orderIds: string[]; method?: string; note?: string }
    if (!Array.isArray(b.orderIds) || !b.orderIds.length) return NextResponse.json({ error: 'Aucune commande sélectionnée' }, { status: 400 })
    const asked = [...new Set(b.orderIds.filter(x => typeof x === 'string'))].slice(0, 5000)
    const who = auth.session.name || auth.session.email; const now = new Date()

    if (b.action === 'collect') {
      const method = ['especes', 'carte', 'virement'].includes(String(b.method)) ? String(b.method) : 'especes'
      const note = b.note ?? null
      const taken = await prisma.$queryRaw<{ id: string; amount: number | null; hubCode: string | null }[]>`
        UPDATE "OpsOrder" SET "collectedAt" = ${now}, "collectedAmount" = COALESCE("amount", 0), "collectedBy" = ${who}, "collectionMethod" = ${method}, "collectionNote" = ${note}
        WHERE "id" = ANY(${asked}::text[]) AND "source" = ${ACTIVE_SOURCE} AND "status" = 'DELIVERED' AND "collectedAt" IS NULL
        RETURNING "id", "amount", "hubCode"`
      const skipped = asked.length - taken.length
      if (!taken.length) return NextResponse.json({ error: 'Aucune commande livrée et non encaissée dans la sélection', collected: 0, updated: 0, skipped }, { status: 409 })
      for (let i = 0; i < taken.length; i += 1000) {
        await prisma.opsOrderEvent.createMany({ data: taken.slice(i, i + 1000).map(o => ({ orderId: o.id, fromStatus: 'DELIVERED', toStatus: 'COLLECTED', at: now, source: 'cash' })), skipDuplicates: true })
      }
      const total = Math.round(taken.reduce((s, o) => s + (o.amount ?? 0), 0))
      await audit(auth.session, 'cash.collect', 'order', taken.length === 1 ? taken[0].id : null, { count: taken.length, skipped, total, method }, taken[0].hubCode)
      bumpOpsEpoch()
      return NextResponse.json({ ok: true, collected: taken.length, updated: taken.length, skipped, total })
    }

    if (b.action === 'revert') {
      const reverted = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "OpsOrder" SET "collectedAt" = NULL, "collectedAmount" = NULL, "collectedBy" = NULL, "collectionMethod" = NULL, "collectionNote" = NULL
        WHERE "id" = ANY(${asked}::text[]) AND "source" = ${ACTIVE_SOURCE} AND "collectedAt" IS NOT NULL
        RETURNING "id"`
      for (let i = 0; i < reverted.length; i += 1000) {
        await prisma.opsOrderEvent.createMany({ data: reverted.slice(i, i + 1000).map(o => ({ orderId: o.id, fromStatus: 'COLLECTED', toStatus: 'COLLECT_REVERTED', at: now, source: 'cash' })), skipDuplicates: true })
      }
      await audit(auth.session, 'cash.revert', 'order', null, { count: reverted.length, skipped: asked.length - reverted.length })
      bumpOpsEpoch()
      return NextResponse.json({ ok: true, reverted: reverted.length, updated: reverted.length, skipped: asked.length - reverted.length })
    }
    return NextResponse.json({ error: 'action invalide' }, { status: 400 })
  } catch (e) { return fail(e) }
}
