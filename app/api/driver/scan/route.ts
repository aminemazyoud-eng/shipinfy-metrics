import { NextRequest, NextResponse } from 'next/server'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { envUnavailable } from '@/lib/env'
import { processScan } from '@/lib/ops-driver-actions'

export const dynamic = 'force-dynamic'

// POST /api/driver/scan { id, barcode, geo? } — scan d'un bac de la tournée : incrémente loadedQty (idempotent par id) et renvoie le reste à charger.
// Le premier scan de la journée tente aussi le check-in officiel (GPS dans le rayon du hub) : voir `checkin` dans la réponse.
export async function POST(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const { limited } = await import('@/lib/rate-limit')
    const l = limited(req, 'driver-scan', 90, 60_000, d.code)
    if (l) return l
    const b = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!b || typeof b.id !== 'string') return driverJson({ error: 'id et barcode requis', code: 'BAD_REQUEST' }, 400)
    const r = await processScan(d, { id: b.id, barcode: b.barcode, geo: b.geo })
    return driverJson(r, r.code === 'BAD_REQUEST' ? 400 : 200)
  } catch (e) {
    const env = envUnavailable(e)
    if (env) { env.headers.set('Cache-Control', 'no-store'); return env }
    console.error('[api/driver/scan]', e)
    return driverJson({ error: 'Erreur serveur' }, 500)
  }
}
