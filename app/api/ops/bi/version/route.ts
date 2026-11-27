import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail } from '@/lib/ops-auth'
import { biVersion, BI_MAX_DAYS } from '@/lib/ops-bi-data'
import { addDays, localToday } from '@/lib/tz'

// GET /api/ops/bi/version?from=YYYY-MM-DD&to=YYYY-MM-DD — empreinte légère des données de la période (une seule requête agrégée).
// Le Dashboard l'interroge toutes les ~10 s pour se rafraîchir tout seul dès qu'une commande change.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    let to = sp.get('to') ?? localToday(), from = sp.get('from') ?? addDays(to, -29)
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return NextResponse.json({ error: 'Dates invalides (YYYY-MM-DD)' }, { status: 400 })
    if (from > to) [from, to] = [to, from]
    if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > BI_MAX_DAYS) return NextResponse.json({ error: `Période trop longue (max ${BI_MAX_DAYS} jours)` }, { status: 400 })
    return NextResponse.json({ version: await biVersion(from, to), serverTime: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return fail(e)
  }
}
