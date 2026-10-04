import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { directMode, loadOrders, loadHubs, loadDrivers, opsNow } from '@/lib/ops-data'
import { forecastDay, resolveDay } from '@/lib/ops-analytics'

// GET /api/ops/forecast?day=today|tomorrow|YYYY-MM-DD|+N &city=CASABLANCA &perDriver=3
// Prévision du nombre de commandes par hub × créneau + charge vs capacité livreurs.
export async function GET(req: NextRequest) {
  if (!directMode()) {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  try {
    const sp = new URL(req.url).searchParams
    const now = await opsNow()
    const day = resolveDay(sp.get('day'), now)
    const dayMs = Date.parse(day + 'T00:00:00Z')
    const perDriver = Number(sp.get('perDriver')) || undefined
    const [orders, hubs, drivers] = await Promise.all([
      loadOrders(new Date(dayMs - 43 * 86_400_000), new Date(dayMs + 86_400_000)), loadHubs(), loadDrivers(),
    ])
    return NextResponse.json(forecastDay(orders, hubs, drivers, day, now, { city: sp.get('city'), perDriverPerSlot: perDriver }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 })
  }
}
