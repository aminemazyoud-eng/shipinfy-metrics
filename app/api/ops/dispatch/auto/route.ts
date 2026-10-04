import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { dayOf, dayBounds } from '@/lib/ops-time'
import { attendanceByName } from '@/lib/ops-attendance'
import { autoAssign } from '@/lib/ops-dispatch'
import { opsSyncConfig } from '@/lib/ops-sync'

// POST /api/ops/dispatch/auto { hub: "CAS-MM", day?: "today", dryRun?: boolean }
// Répartit les commandes non affectées du hub entre les livreurs présents, en équilibrant la charge et en regroupant par proximité.
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { hub, day: daySpec, dryRun } = await req.json() as { hub: string; day?: string; dryRun?: boolean }
    if (!hub) return NextResponse.json({ error: 'hub requis' }, { status: 400 })
    const day = dayOf(daySpec)
    const { from, to } = dayBounds(day)

    const [orders, drivers, att] = await Promise.all([
      prisma.opsOrder.findMany({ where: { hubCode: hub, driverId: null, status: 'READY_PICKUP', slotStart: { gte: from, lt: to } }, select: { id: true, externalId: true, slotStart: true, lat: true, lng: true } }),
      prisma.opsDriver.findMany({ where: { hub: { code: hub }, status: 'active', jobType: 'chauffeur' }, select: { id: true, code: true, firstName: true, lastName: true } }),
      attendanceByName(day),
    ])
    const available = drivers.filter(d => { const s = att.get(`${d.firstName} ${d.lastName}`)?.status; return s !== 'absent' && s !== 'leave' })
    if (!available.length) return NextResponse.json({ error: 'Aucun livreur disponible sur ce hub (absents ou aucun affecté)' }, { status: 409 })
    if (!orders.length) return NextResponse.json({ ok: true, assigned: 0, message: 'Rien à dispatcher' })

    const existing = await prisma.opsOrder.findMany({ where: { driverId: { in: available.map(d => d.id) }, status: { notIn: ['DELIVERED', 'NO_SHOW'] }, slotStart: { gte: from, lt: to } }, select: { driverId: true, lat: true, lng: true } })
    const plan = autoAssign(
      orders.map(o => ({ id: o.id, slotStart: o.slotStart.getTime(), lat: o.lat, lng: o.lng })),
      available.map(d => ({ id: d.id, code: d.code, load: 0, points: existing.filter(e => e.driverId === d.id && e.lat != null && e.lng != null).map(e => [e.lat as number, e.lng as number] as [number, number]) })),
      existing.reduce<Record<string, number>>((acc, e) => { acc[e.driverId as string] = (acc[e.driverId as string] || 0) + 1; return acc }, {}),
    )
    const summary = available.map(d => ({ code: d.code, count: plan.filter(p => p.driverId === d.id).length }))
    if (dryRun) return NextResponse.json({ ok: true, dryRun: true, assigned: plan.length, summary })

    const now = new Date()
    for (const d of available) {
      const ids = plan.filter(p => p.driverId === d.id).map(p => p.orderId)
      if (!ids.length) continue
      await prisma.$transaction([
        prisma.opsOrder.updateMany({ where: { id: { in: ids } }, data: { driverId: d.id, courierRef: d.code, status: 'ASSIGNED', assignedAt: now } }),
        prisma.opsOrderEvent.createMany({ data: ids.map(id => ({ orderId: id, fromStatus: 'READY_PICKUP', toStatus: 'ASSIGNED', at: now, source: 'dispatch' })) }),
      ])
    }
    const { url, key } = opsSyncConfig()
    const extId = new Map(orders.map(o => [o.id, o.externalId]))
    const code = new Map(available.map(d => [d.id, d.code]))
    await Promise.all(plan.map(async p => {
      try { await fetch(`${url}/api/v1/orders/${encodeURIComponent(extId.get(p.orderId) as string)}/assign`, { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ courierRef: code.get(p.driverId) }), signal: AbortSignal.timeout(4000) }) } catch { /* best effort */ }
    }))
    await audit(auth.session, 'dispatch.auto', 'order', null, { hub, day, assigned: plan.length, summary }, hub)
    return NextResponse.json({ ok: true, assigned: plan.length, summary })
  } catch (e) { return fail(e) }
}
