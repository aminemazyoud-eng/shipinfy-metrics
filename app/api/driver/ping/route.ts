import { NextRequest } from 'next/server'
import { limited } from '@/lib/rate-limit'
import { driverJson } from '@/lib/ops-driver-token'

export const dynamic = 'force-dynamic'

// GET /api/driver/ping — détection de connexion de l'application livreur. Public volontairement : aucune donnée, limité par IP.
export async function GET(req: NextRequest) {
  const l = limited(req, 'driver-ping', 300, 60_000)
  if (l) { l.headers.set('Cache-Control', 'no-store'); return l }
  return driverJson({ ok: true, serverTime: new Date().toISOString() })
}
