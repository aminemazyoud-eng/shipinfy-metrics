import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { loadRouteSettings, saveRouteSettings, DEFAULT_ROUTE_SETTINGS } from '@/lib/ops-route'
import { trafficProviderEnabled } from '@/lib/ops-eta'

export const dynamic = 'force-dynamic'

// GET /api/ops/tours/params → { settings, defaults, trafficProvider } — réglages tournées / ETA / vagues (OpsSetting, clés route.* / eta.*)
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try { return NextResponse.json({ settings: await loadRouteSettings(true), defaults: DEFAULT_ROUTE_SETTINGS, trafficProvider: trafficProviderEnabled() }) } catch (e) { return fail(e) }
}

// PUT /api/ops/tours/params { serviceMin?, maxStops?, rotationsPerSlot?, loadMin?, maxPostpones?, waveTarget?, waveMax?, waveWidenMin?, etaDriftNotifyMin?, baseSpeedKmh?, roadFactor?, trafficCoef?, defaultLegMin?, minLegMin?, trafficCurve?: number[24] }
export async function PUT(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!b || typeof b !== 'object') return NextResponse.json({ error: 'Corps invalide' }, { status: 400 })
    const settings = await saveRouteSettings(b)
    await audit(auth.session, 'tour.params', 'setting', null, { keys: Object.keys(b).slice(0, 20) })
    return NextResponse.json({ ok: true, settings })
  } catch (e) { return fail(e) }
}
