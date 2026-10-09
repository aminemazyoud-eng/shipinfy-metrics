import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { rebalanceZone } from '@/lib/shift-engine'
import { audit } from '@/lib/ops-auth'

export const runtime = 'nodejs'

// POST /api/shifts/rebalance — rééquilibrer une zone/date
export async function POST(req: Request) {
  const _guard = await requireSession(req, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const body = await req.json()
    const { zone, date } = body

    if (!zone || !date) {
      return NextResponse.json({ error: 'zone et date requis' }, { status: 400 })
    }

    const slotDate = new Date(date)
    slotDate.setHours(0, 0, 0, 0)

    await rebalanceZone(zone, slotDate)
    await audit(_guard.session, 'shift.rebalance', 'shift', null, { zone, date })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
