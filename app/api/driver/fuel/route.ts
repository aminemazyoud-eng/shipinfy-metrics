import { NextRequest, NextResponse } from 'next/server'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { logFuel } from '@/lib/ops-driver-actions'

export const dynamic = 'force-dynamic'

// POST /api/driver/fuel { id, liters, amount, km?, station? } — plein de carburant du véhicule du livreur (OpsFuelLog). Idempotent par id.
export async function POST(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const b = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!b || typeof b.id !== 'string') return driverJson({ error: 'id, liters et amount requis', code: 'BAD_REQUEST' }, 400)
    const r = await logFuel(d, { id: b.id, liters: b.liters, amount: b.amount, km: b.km, station: b.station })
    return driverJson(r, r.ok ? 200 : r.code === 'ID_CONFLICT' ? 409 : 422)
  } catch (e) { console.error('[api/driver/fuel]', e); return driverJson({ error: 'Erreur serveur' }, 500) }
}
