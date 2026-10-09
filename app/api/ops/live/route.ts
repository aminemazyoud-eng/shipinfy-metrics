import { NextRequest, NextResponse } from 'next/server'
import { opsAuth } from '@/lib/ops-auth'
import { loadOrders, loadHubs, loadDrivers, opsNow } from '@/lib/ops-data'
import { liveSnapshot } from '@/lib/ops-analytics'
import { localDay, dayBoundsTz } from '@/lib/tz'

// GET /api/ops/live?city=&hub=
// Photo temps réel : par hub (statuts, retards, à risque), par créneau, points carte, charge livreurs.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const now = await opsNow()
    const { from: dayFrom, to: dayTo } = dayBoundsTz(localDay(now)) // fuseau Casablanca réel (Ramadan inclus)
    const [orders, hubs, drivers] = await Promise.all([
      loadOrders(dayFrom, dayTo, { includeOpenBefore: true }), loadHubs(), loadDrivers(),
    ])
    return NextResponse.json(liveSnapshot(orders, hubs, drivers, now, { city: sp.get('city'), hub: sp.get('hub') }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 })
  }
}
