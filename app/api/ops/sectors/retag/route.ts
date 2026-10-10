import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { retagDay, invalidateSectors } from '@/lib/ops-sectors'
import { dayOfTz } from '@/lib/tz'
import { bumpOpsEpoch } from '@/lib/ops-cache'

export const dynamic = 'force-dynamic'

// POST /api/ops/sectors/retag { day?: "today" } — recalcule le secteur de toutes les commandes du jour (après modification des polygones)
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const body = await req.json().catch(() => ({})) as { day?: string }
    const day = dayOfTz(body.day)
    invalidateSectors()
    const r = await retagDay(day)
    bumpOpsEpoch()
    await audit(auth.session, 'sector.retag', 'sector', null, { day, ...r })
    return NextResponse.json({ ok: true, day, ...r })
  } catch (e) { return fail(e) }
}
