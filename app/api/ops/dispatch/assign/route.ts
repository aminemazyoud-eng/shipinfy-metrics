import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { opsSyncConfig, enqueueAssign } from '@/lib/ops-sync'
import { ACTIVE_SOURCE } from '@/lib/ops-data'
import { TERMINAL_STATUSES } from '@/lib/ops-defs'
import { bumpOpsEpoch } from '@/lib/ops-cache'

// POST /api/ops/dispatch/assign  { orderIds: string[], driverCode: string | null }   (null = retirer l'affectation)
// Notre dispatch est prioritaire (driverId) ; l'affectation est aussi poussée au back-office (best effort, rejouée via OpsOutbox).
// Sprint 17 B3 — « first claim wins » : l'UPDATE conditionnel est atomique, les événements ne sont créés que pour les lignes réellement prises.
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { orderIds, driverCode } = await req.json() as { orderIds: string[]; driverCode: string | null }
    if (!Array.isArray(orderIds) || !orderIds.length) return NextResponse.json({ error: 'orderIds requis' }, { status: 400 })
    const asked = [...new Set(orderIds.filter(x => typeof x === 'string'))].slice(0, 2000)
    const driver = driverCode ? await prisma.opsDriver.findUnique({ where: { code: driverCode } }) : null
    if (driverCode && !driver) return NextResponse.json({ error: 'Livreur inconnu' }, { status: 404 })

    const orders = await prisma.opsOrder.findMany({ where: { id: { in: asked }, source: ACTIVE_SOURCE, status: { notIn: [...TERMINAL_STATUSES] } }, select: { id: true, externalId: true, status: true, hubCode: true } })
    if (!orders.length) return NextResponse.json({ error: 'Aucune commande modifiable' }, { status: 400 })
    const now = new Date()
    const toAssign = orders.filter(o => o.status === 'READY_PICKUP').map(o => o.id)
    const toReassign = orders.filter(o => o.status === 'ASSIGNED').map(o => o.id)

    let touched: string[] = [] // ids réellement modifiés par CETTE requête
    if (driver) {
      // affectation : seule la première requête qui trouve la commande READY_PICKUP sans livreur la prend
      const claimed = toAssign.length ? await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "OpsOrder" SET "driverId" = ${driver.id}, "courierRef" = ${driver.code}, "status" = 'ASSIGNED', "assignedAt" = ${now}
        WHERE "id" = ANY(${toAssign}::text[]) AND "status" = 'READY_PICKUP' AND "driverId" IS NULL
        RETURNING "id"` : []
      if (claimed.length) await prisma.opsOrderEvent.createMany({ data: claimed.map(r => ({ orderId: r.id, fromStatus: 'READY_PICKUP', toStatus: 'ASSIGNED', at: now, source: 'dispatch' })), skipDuplicates: true })
      // changement de livreur d'une commande déjà ASSIGNED (pas encore acceptée) : pas de changement de statut
      const moved = toReassign.length ? await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "OpsOrder" SET "driverId" = ${driver.id}, "courierRef" = ${driver.code}
        WHERE "id" = ANY(${toReassign}::text[]) AND "status" = 'ASSIGNED'
        RETURNING "id"` : []
      touched = [...claimed.map(r => r.id), ...moved.map(r => r.id)]
    } else {
      // désaffectation : uniquement les commandes ASSIGNED (jamais celles déjà en route)
      const freed = toReassign.length ? await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "OpsOrder" SET "driverId" = NULL, "courierRef" = NULL, "status" = 'READY_PICKUP', "assignedAt" = NULL
        WHERE "id" = ANY(${toReassign}::text[]) AND "status" = 'ASSIGNED'
        RETURNING "id"` : []
      touched = freed.map(r => r.id)
    }
    const touchedSet = new Set(touched)
    const skippedIds = asked.filter(id => !touchedSet.has(id))
    if (!touched.length) return NextResponse.json({ error: 'Aucune commande modifiée : déjà prises ou en cours de livraison', updated: 0, skipped: skippedIds.length, skippedIds }, { status: 409 })

    // poussée vers le back-office (le mock accepte POST /api/v1/orders/:id/assign) — l'échec n'annule pas l'affectation locale, il est rejoué
    const { url, key } = opsSyncConfig()
    const byId = new Map(orders.map(o => [o.id, o]))
    let pushed = 0
    const failedPush: { externalId: string; courierRef: string | null }[] = []
    await Promise.all(touched.map(async id => {
      const o = byId.get(id)
      if (!o) return
      try {
        const r = await fetch(`${url}/api/v1/orders/${encodeURIComponent(o.externalId)}/assign`, { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ courierRef: driver?.code ?? null }), signal: AbortSignal.timeout(4000) })
        if (r.ok) pushed++; else failedPush.push({ externalId: o.externalId, courierRef: driver?.code ?? null })
      } catch { failedPush.push({ externalId: o.externalId, courierRef: driver?.code ?? null }) /* back-office indisponible */ }
    }))
    if (failedPush.length) await enqueueAssign(failedPush)

    const first = byId.get(touched[0])
    await audit(auth.session, driver ? 'dispatch.assign' : 'dispatch.unassign', 'order', touched.length === 1 ? touched[0] : null, { count: touched.length, skipped: skippedIds.length, driver: driver?.code ?? null, pushed }, first?.hubCode)
    bumpOpsEpoch() // le dispatcher voit tout de suite son action
    return NextResponse.json({ ok: true, updated: touched.length, skipped: skippedIds.length, skippedIds, pushedToBackoffice: pushed })
  } catch (e) { return fail(e) }
}
