import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail } from '@/lib/ops-auth'
import { fleetLive } from '@/lib/ops-tours'
import { dayOfTz } from '@/lib/tz'

export const dynamic = 'force-dynamic'

// GET /api/ops/fleet-live?day=today&hub=&minutes=15
// → { vehicles:[{ driverCode, name, lat, lng, at, ageSec, speedKmh, tourId, done, total, nextStop, lateStops }], tours:[…], alerts:[{ id, kind, severity, message, … }], totals, etaNote, trafficLive }
// Position = dernière OpsDriverPosition de moins de `minutes` min (défaut 15). Alertes : slot_late, delivery_risk, no_signal, geo_outside.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const m = Number(sp.get('minutes'))
    return NextResponse.json(await fleetLive(dayOfTz(sp.get('day')), { hub: sp.get('hub') || null, positionMin: Number.isFinite(m) && m >= 1 && m <= 120 ? Math.round(m) : 15 }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fail(e) }
}
