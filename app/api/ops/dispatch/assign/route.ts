import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { opsSyncConfig } from '@/lib/ops-sync'

// POST /api/ops/dispatch/assign  { orderIds: string[], driverCode: string | null }   (null = retirer l'affectation)
// Notre dispatch est prioritaire (driverId) ; l'affectation est aussi poussée au back-office (best effort).
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { orderIds, driverCode } = await req.json() as { orderIds: string[]; driverCode: string | null }
    if (!Array.isArray(orderIds) || !orderIds.length) return NextResponse.json({ error: 'orderIds requis' }, { status: 400 })
    const driver = driverCode ? await prisma.opsDriver.findUnique({ where: { code: driverCode } }) : null
    if (driverCode && !driver) return NextResponse.json({ error: 'Livreur inconnu' }, { status: 404 })

    const orders = await prisma.opsOrder.findMany({ where: { id: { in: orderIds }, status: { notIn: ['DELIVERED', 'NO_SHOW'] } }, select: { id: true, externalId: true, status: true, source: true, hubCode: true } })
    if (!orders.length) return NextResponse.json({ error: 'Aucune commande modifiable' }, { status: 400 })
    const now = new Date()

    const toAssign = orders.filter(o => o.status === 'READY_PICKUP').map(o => o.id)
    const toUnassign = orders.filter(o => o.status === 'ASSIGNED').map(o => o.id)
    await prisma.$transaction([
      prisma.opsOrder.updateMany({ where: { id: { in: orders.map(o => o.id) } }, data: { driverId: driver?.id ?? null, courierRef: driver?.code ?? null } }),
      ...(driver && toAssign.length ? [prisma.opsOrder.updateMany({ where: { id: { in: toAssign } }, data: { status: 'ASSIGNED', assignedAt: now } })] : []),
      ...(!driver && toUnassign.length ? [prisma.opsOrder.updateMany({ where: { id: { in: toUnassign } }, data: { status: 'READY_PICKUP', assignedAt: null } })] : []),
      ...(driver && toAssign.length ? [prisma.opsOrderEvent.createMany({ data: toAssign.map(id => ({ orderId: id, fromStatus: 'READY_PICKUP', toStatus: 'ASSIGNED', at: now, source: 'dispatch' })) })] : []),
    ])

    // poussée vers le back-office (le mock accepte POST /api/v1/orders/:id/assign) — l'échec n'annule pas l'affectation locale
    const { url, key } = opsSyncConfig()
    let pushed = 0
    await Promise.all(orders.map(async o => {
      try {
        const r = await fetch(`${url}/api/v1/orders/${encodeURIComponent(o.externalId)}/assign`, { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ courierRef: driver?.code ?? null }), signal: AbortSignal.timeout(4000) })
        if (r.ok) pushed++
      } catch { /* back-office indisponible */ }
    }))

    await audit(auth.session, driver ? 'dispatch.assign' : 'dispatch.unassign', 'order', orders.length === 1 ? orders[0].id : null, { count: orders.length, driver: driver?.code ?? null, pushed }, orders[0].hubCode)
    return NextResponse.json({ ok: true, updated: orders.length, pushedToBackoffice: pushed })
  } catch (e) { return fail(e) }
}
