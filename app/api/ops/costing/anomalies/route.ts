import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail } from '@/lib/ops-auth'
import { computeCosting, parseRange, detectAnomalies } from '@/lib/ops-costing'

// GET /api/ops/costing/anomalies?from=&to=&hub= — km/commande élevé, consommation anormale, véhicule sous-utilisé, rotations à 1-2 commandes, journées coûteuses (avec recommandations). MANAGER+.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const range = parseRange(sp)
    if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 })
    const data = await computeCosting(range.from, range.to, { hub: sp.get('hub') || undefined })
    const anomalies = detectAnomalies(data.days, data.fleet, data.params)
    return NextResponse.json({ from: range.from, to: range.to, count: anomalies.length, anomalies, meta: data.meta })
  } catch (e) { return fail(e) }
}
