import { NextRequest, NextResponse } from 'next/server'
import { loadTeams } from '@/lib/ops-planning-data'
import { buildTeamPdf, verifyPlan } from '@/lib/ops-planning'
import { limited } from '@/lib/rate-limit'
import { envUnavailable } from '@/lib/env'

const NO_INDEX = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' }

// GET /api/planning/pdf?d=YYYY-MM-DD&c=D07&e=<exp ms>&t=<jeton> — PDF d'une équipe. PUBLIC (lien signé envoyé par WhatsApp) :
// le jeton est lié au jour, au chauffeur et à la date d'expiration (fin du jour planifié + 24 h).
export async function GET(req: NextRequest) {
  const lim = limited(req, 'planning-pdf', 30, 60_000)
  if (lim) return lim
  const sp = new URL(req.url).searchParams
  const d = sp.get('d') ?? '', c = sp.get('c') ?? '', t = sp.get('t') ?? '', e = Number(sp.get('e'))
  try {
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || !c || !t || !Number.isFinite(e) || !verifyPlan(d, c, e, t)) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 403, headers: NO_INDEX })
    const [team] = await loadTeams(d, [c])
    if (!team) return NextResponse.json({ error: 'Planning introuvable' }, { status: 404, headers: NO_INDEX })
    const pdf = await buildTeamPdf(team)
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="planning_${d}_${c}.pdf"`, ...NO_INDEX } })
  } catch (err) {
    const env = envUnavailable(err); if (env) return env // PLANNING_LINK_SECRET absent → 503 propre
    console.error('[api/planning/pdf]', err); return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
