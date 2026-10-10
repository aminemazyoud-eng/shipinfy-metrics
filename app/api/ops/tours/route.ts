import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { getToursForDay, reorderTour } from '@/lib/ops-tours'
import { dayOfTz } from '@/lib/tz'

export const dynamic = 'force-dynamic'

// GET /api/ops/tours?day=today&hub=CAS-MM
// → { day, hub, etaNote, trafficLive, unplanned, unassigned, tours:[{ id, driverCode, driverName, rotation, status, total, done, remaining, progressPct, nextEtaAt, lateStops, etaLateStops, stops:[{ orderId, ref, seq, status, etaAt, postponedCount, late, lateMin, etaLateMin, … }] }] }
// Les ETA sont « estimées sans trafic live » (etaNote) sauf si un fournisseur externe est configuré (trafficLive).
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    return NextResponse.json(await getToursForDay(dayOfTz(sp.get('day')), sp.get('hub') || null))
  } catch (e) { return fail(e) }
}

// PATCH /api/ops/tours { tourId, orderIds: [...] } — réordonnancement manuel des stops OUVERTS (ordre voulu complet)
export async function PATCH(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json().catch(() => null) as { tourId?: unknown; orderIds?: unknown } | null
    if (!b || typeof b.tourId !== 'string' || !Array.isArray(b.orderIds) || b.orderIds.length > 200 || !b.orderIds.every(x => typeof x === 'string')) return NextResponse.json({ error: 'tourId et orderIds requis' }, { status: 400 })
    const r = await reorderTour(b.tourId, b.orderIds as string[])
    if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.code === 'NOT_FOUND' ? 404 : 409 })
    await audit(auth.session, 'tour.reorder', 'tour', b.tourId, { count: b.orderIds.length })
    return NextResponse.json({ ok: true })
  } catch (e) { return fail(e) }
}
