import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail } from '@/lib/ops-auth'
import { loadBiOrders, BI_MAX_DAYS } from '@/lib/ops-bi-data'
import { addDays, localToday } from '@/lib/tz'

// GET /api/ops/bi/orders?from=YYYY-MM-DD&to=YYYY-MM-DD[&cancelled=1]
// Commandes (jour de transmission local dans [from, to]) au format des 22 colonnes de l'ancien export CSV,
// alimentées par l'API du back-office. Les KPI du dashboard sont calculés côté navigateur (lib/ops-bi.ts).
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const today = localToday()
    let to = sp.get('to') ?? today, from = sp.get('from') ?? addDays(to, -29)
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return NextResponse.json({ error: 'Dates invalides (YYYY-MM-DD)' }, { status: 400 })
    if (from > to) [from, to] = [to, from]
    const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
    if (span > BI_MAX_DAYS) return NextResponse.json({ error: `Période trop longue (max ${BI_MAX_DAYS} jours)` }, { status: 400 })
    const payload = await loadBiOrders(from, to, sp.get('cancelled') === '1')
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return fail(e)
  }
}
