import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { dayOfTz } from '@/lib/tz'
import { loadPilot, loadLeaderboard, applyReassignments } from '@/lib/ops-pilot'

export const dynamic = 'force-dynamic'

// GET /api/ops/pilot?day=today&hub=CAS-MM → { reassign:[…], predictions:[…], leaderboard:{ [hub]: Standing[] } } — lecture seule
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const day = dayOfTz(sp.get('day'))
    const [pilot, board] = await Promise.all([loadPilot(day, sp.get('hub') || null), loadLeaderboard(day)])
    return NextResponse.json({ ...pilot, leaderboard: board }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fail(e) }
}

// POST /api/ops/pilot { items:[{ orderId, from, to }] } — applique des réaffectations validées par le dispatcher (compare-and-set + audit)
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { items } = await req.json() as { items?: { orderId: string; from: string; to: string }[] }
    if (!Array.isArray(items) || !items.length || items.length > 100 || items.some(i => !i?.orderId || !i?.from || !i?.to)) return NextResponse.json({ error: 'items invalides' }, { status: 400 })
    const moved = await applyReassignments(items)
    await audit(auth.session, 'dispatch.reassign', 'order', null, { requested: items.length, moved })
    return NextResponse.json({ ok: true, moved, skipped: items.length - moved })
  } catch (e) { return fail(e) }
}
