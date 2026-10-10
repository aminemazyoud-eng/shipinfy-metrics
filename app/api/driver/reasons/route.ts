import { NextRequest, NextResponse } from 'next/server'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { listReasons } from '@/lib/ops-reasons'

export const dynamic = 'force-dynamic'

// GET /api/driver/reasons — nomenclature des motifs de non-livraison actifs (FR + AR). Sème la liste par défaut au premier appel.
export async function GET(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const reasons = await listReasons({ activeOnly: true })
    return driverJson({ reasons: reasons.map(r => ({ code: r.code, label: r.label, labelAr: r.labelAr, kind: r.kind, cod: r.cod, rto: r.rto })) })
  } catch (e) { console.error('[api/driver/reasons]', e); return driverJson({ error: 'Erreur serveur' }, 500) }
}
