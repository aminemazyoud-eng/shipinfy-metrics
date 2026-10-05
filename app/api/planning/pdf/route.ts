import { NextRequest, NextResponse } from 'next/server'
import { loadTeams } from '@/lib/ops-planning-data'
import { buildTeamPdf, verifyPlan } from '@/lib/ops-planning'

// GET /api/planning/pdf?d=YYYY-MM-DD&c=D07&t=<jeton>  — PDF d'une équipe. PUBLIC (lien signé envoyé par WhatsApp) : le jeton est lié au jour et au chauffeur.
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const d = sp.get('d') ?? '', c = sp.get('c') ?? '', t = sp.get('t') ?? ''
  if (!/^\d{4}-\d\d-\d\d$/.test(d) || !c || !verifyPlan(d, c, t)) return NextResponse.json({ error: 'Lien invalide' }, { status: 403 })
  try {
    const [team] = await loadTeams(d, [c])
    if (!team) return NextResponse.json({ error: 'Planning introuvable' }, { status: 404 })
    const pdf = await buildTeamPdf(team)
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="planning_${d}_${c}.pdf"`, 'Cache-Control': 'private, max-age=60' } })
  } catch (e) { console.error('[api/planning/pdf]', e); return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 }) }
}
