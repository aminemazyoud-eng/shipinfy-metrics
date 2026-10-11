import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { dayOfTz, dayBoundsTz } from '@/lib/tz'
import { ACTIVE_SOURCE } from '@/lib/ops-data'
import { TERMINAL_STATUSES } from '@/lib/ops-defs'
import { detectBundles } from '@/lib/dispatch-engine'

export const dynamic = 'force-dynamic'

// GET /api/ops/dispatch/bundles?hub=CAS-MM&day=today&radius=500
// Regroupement intelligent (bundling) des commandes OUVERTES du hub, en temps réel : mêmes règles que l'ancien /api/dispatch/bundles
// (proximité GPS ≤ rayon, sinon même quartier), mais sur OpsOrder au lieu d'un rapport importé. Lecture seule : conseil, rien n'est enregistré.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const hub = sp.get('hub') || undefined
    const day = dayOfTz(sp.get('day'))
    const radius = Math.min(5000, Math.max(100, Number(sp.get('radius')) || 500))
    const { from, to } = dayBoundsTz(day)
    const rows = await prisma.opsOrder.findMany({
      where: { source: ACTIVE_SOURCE, slotStart: { gte: from, lt: to }, status: { notIn: [...TERMINAL_STATUSES] }, ...(hub ? { hubCode: hub } : {}) },
      select: { id: true, reference: true, externalId: true, district: true, sectorCode: true, lat: true, lng: true, driverId: true },
    })
    const ref = new Map(rows.map(o => [o.id, o.reference ?? o.externalId]))
    const free = new Set(rows.filter(o => !o.driverId).map(o => o.id))
    const { bundles } = detectBundles(rows.map(o => ({ id: o.id, address: o.district ?? '', lat: o.lat ?? undefined, lng: o.lng ?? undefined, zone: o.sectorCode ?? o.district ?? undefined })), radius)
    const out = bundles.filter(b => b.orderIds.length >= 2)
      .map(b => ({ orderIds: b.orderIds, zone: b.zone, estimatedSaving: b.estimatedSaving, refs: b.orderIds.map(id => ref.get(id) ?? '—'), unassigned: b.orderIds.filter(id => free.has(id)).length }))
      .sort((a, b) => b.estimatedSaving - a.estimatedSaving)
    return NextResponse.json({ day, hub: hub ?? null, radius, bundles: out })
  } catch (e) { return fail(e) }
}
