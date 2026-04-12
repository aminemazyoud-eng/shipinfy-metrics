import { NextResponse } from 'next/server'
import { rebalanceZone } from '@/lib/shift-engine'

export const runtime = 'nodejs'

// POST /api/shifts/rebalance — rééquilibrer une zone/date
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { zone, date } = body

    if (!zone || !date) {
      return NextResponse.json({ error: 'zone et date requis' }, { status: 400 })
    }

    const slotDate = new Date(date)
    slotDate.setHours(0, 0, 0, 0)

    await rebalanceZone(zone, slotDate)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
