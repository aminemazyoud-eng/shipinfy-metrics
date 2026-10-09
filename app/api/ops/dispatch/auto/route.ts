import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { dayOfTz, dayBoundsTz } from '@/lib/tz'
import { attendanceByName } from '@/lib/ops-attendance'
import { autoAssign } from '@/lib/ops-dispatch'
import { opsSyncConfig, enqueueAssign } from '@/lib/ops-sync'
import { ACTIVE_SOURCE } from '@/lib/ops-data'
import { TERMINAL_STATUSES } from '@/lib/ops-defs'
import { bumpOpsEpoch } from '@/lib/ops-cache'

// POST /api/ops/dispatch/auto { hub: "CAS-MM", day?: "today", dryRun?: boolean }
// Répartit les commandes non affectées du hub entre les livreurs présents, en équilibrant la charge et en regroupant par proximité.
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { hub, day: daySpec, dryRun } = await req.json() as { hub: string; day?: string; dryRun?: boolean }
    if (!hub) return NextResponse.json({ error: 'hub requis' }, { status: 400 })
    const day = dayOfTz(daySpec)
    const { from, to } = dayBoundsTz(day)

    const [orders, drivers, att] = await Promise.all([
      prisma.opsOrder.findMany({ where: { source: ACTIVE_SOURCE, hubCode: hub, driverId: null, status: 'READY_PICKUP', slotStart: { gte: from, lt: to } }, select: { id: true, externalId: true, slotStart: true, lat: true, lng: true } }),
      prisma.opsDriver.findMany({ where: { hub: { code: hub }, status: 'active', jobType: 'chauffeur' }, select: { id: true, code: true, firstName: true, lastName: true } }),
      attendanceByName(day),
    ])
    const available = drivers.filter(d => { const s = att.get(`${d.firstName} ${d.lastName}`)?.status; return s !== 'absent' && s !== 'leave' })
    if (!available.length) return NextResponse.json({ error: 'Aucun livreur disponible sur ce hub (absents ou aucun affecté)' }, { status: 409 })
    if (!orders.length) return NextResponse.json({ ok: true, assigned: 0, message: 'Rien à dispatcher' })

    const existing = await prisma.opsOrder.findMany({ where: { source: ACTIVE_SOURCE, driverId: { in: available.map(d => d.id) }, status: { notIn: [...TERMINAL_STATUSES] }, slotStart: { gte: from, lt: to } }, select: { driverId: true, lat: true, lng: true } })
    const plan = autoAssign(
      orders.map(o => ({ id: o.id, slotStart: o.slotStart.getTime(), lat: o.lat, lng: o.lng })),
      available.map(d => ({ id: d.id, code: d.code, load: 0, points: existing.filter(e => e.driverId === d.id && e.lat != null && e.lng != null).map(e => [e.lat as number, e.lng as number] as [number, number]) })),
      existing.reduce<Record<string, number>>((acc, e) => { acc[e.driverId as string] = (acc[e.driverId as string] || 0) + 1; return acc }, {}),
    )
    const summary = available.map(d => ({ code: d.code, count: plan.filter(p => p.driverId === d.id).length }))
    if (dryRun) return NextResponse.json({ ok: true, dryRun: true, assigned: plan.length, summary })

    const now = new Date()
    // Sprint 17 B3 — « first claim wins » : seules les commandes encore READY_PICKUP sans livreur sont prises ; événements d'après RETURNING
    const claimedIds = new Set<string>()
    const claimedBy = new Map<string, string>() // orderId -> code livreur
    for (const d of available) {
      const ids = plan.filter(p => p.driverId === d.id).map(p => p.orderId)
      if (!ids.length) continue
      const claimed = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "OpsOrder" SET "driverId" = ${d.id}, "courierRef" = ${d.code}, "status" = 'ASSIGNED', "assignedAt" = ${now}
        WHERE "id" = ANY(${ids}::text[]) AND "status" = 'READY_PICKUP' AND "driverId" IS NULL
        RETURNING "id"`
      if (!claimed.length) continue
      await prisma.opsOrderEvent.createMany({ data: claimed.map(r => ({ orderId: r.id, fromStatus: 'READY_PICKUP', toStatus: 'ASSIGNED', at: now, source: 'dispatch' })), skipDuplicates: true })
      claimed.forEach(r => { claimedIds.add(r.id); claimedBy.set(r.id, d.code) })
    }
    const skipped = plan.length - claimedIds.size
    const { url, key } = opsSyncConfig()
    const extId = new Map(orders.map(o => [o.id, o.externalId]))
    const failedPush: { externalId: string; courierRef: string | null }[] = []
    await Promise.all([...claimedIds].map(async id => {
      const externalId = extId.get(id) as string, courierRef = claimedBy.get(id) ?? null
      try {
        const r = await fetch(`${url}/api/v1/orders/${encodeURIComponent(externalId)}/assign`, { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ courierRef }), signal: AbortSignal.timeout(4000) })
        if (!r.ok) failedPush.push({ externalId, courierRef })
      } catch { failedPush.push({ externalId, courierRef }) /* back-office indisponible : rejoué via OpsOutbox */ }
    }))
    if (failedPush.length) await enqueueAssign(failedPush)
    await audit(auth.session, 'dispatch.auto', 'order', null, { hub, day, assigned: claimedIds.size, skipped, summary }, hub)
    bumpOpsEpoch()
    return NextResponse.json({ ok: true, assigned: claimedIds.size, updated: claimedIds.size, skipped, summary })
  } catch (e) { return fail(e) }
}
