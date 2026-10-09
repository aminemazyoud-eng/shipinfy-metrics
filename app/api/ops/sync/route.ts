import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, roleAtLeast } from '@/lib/auth'
import { runOpsSync, opsSyncConfig } from '@/lib/ops-sync'
import { ACTIVE_SOURCE } from '@/lib/ops-data'

// GET /api/ops/sync — état de la synchro back-office (derniers runs, source, volumétrie)
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  try {
    const { url, source } = opsSyncConfig()
    const [runs, orders, lastEvent] = await Promise.all([
      prisma.opsSyncRun.findMany({ where: { source }, orderBy: { startedAt: 'desc' }, take: 10 }),
      prisma.opsOrder.count({ where: { source: ACTIVE_SOURCE } }),
      prisma.opsOrderEvent.findFirst({ orderBy: { at: 'desc' }, select: { at: true } }),
    ])
    return NextResponse.json({
      source, backofficeUrl: url, autoSync: process.env.OPS_SYNC_ENABLED === 'true', intervalMin: 5,
      orders, lastEventAt: lastEvent?.at ?? null, lastOk: runs.find(r => r.ok) ?? null, runs,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 })
  }
}

// POST /api/ops/sync[?full=1] — déclenche une synchro maintenant (full = ignore le curseur)
export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  if (!roleAtLeast(session.role, 'COORDINATOR')) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const full = new URL(req.url).searchParams.get('full') === '1'
  const result = await runOpsSync({ full })
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
