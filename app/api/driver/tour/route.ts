import { NextRequest, NextResponse } from 'next/server'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { envUnavailable } from '@/lib/env'
import { getTourForDriver } from '@/lib/ops-tours'
import { localToday } from '@/lib/tz'

export const dynamic = 'force-dynamic'

// GET /api/driver/tour — tournée du jour du livreur (jeton HMAC) : la première non terminée, sinon la dernière. UNIQUEMENT ses commandes.
// → { tour:{ id, status, rotation, day, hubCode, rotations, maxPostpones, etaNote }|null, stops:[{ orderId, ref, seq, etaAt, customer, address, lat, lng, status, postponedCount, canPostpone, slotEnd, items:[{ id, label, qty, barcode, loadedQty }] }], serverTime }
// etaAt = estimation « sans trafic live » (etaNote). Aucune donnée d'un autre livreur.
export async function GET(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const now = Date.now()
    const view = await getTourForDriver(d.code, localToday(now))
    return driverJson({ ...view, serverTime: new Date(now).toISOString() })
  } catch (e) {
    const env = envUnavailable(e)
    if (env) { env.headers.set('Cache-Control', 'no-store'); return env }
    console.error('[api/driver/tour]', e)
    return driverJson({ error: 'Erreur serveur' }, 500)
  }
}
