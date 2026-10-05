import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail } from '@/lib/ops-auth'
import { loadTeams } from '@/lib/ops-planning-data'
import { buildDayPdf, buildTeamPdf } from '@/lib/ops-planning'

// GET /api/ops/planning/pdf?day=YYYY-MM-DD[&driver=D07] — récapitulatif du jour (tous les hubs) ou fiche d'une équipe
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const day = sp.get('day') ?? '', driver = sp.get('driver')
    if (!/^\d{4}-\d\d-\d\d$/.test(day)) return NextResponse.json({ error: 'day requis' }, { status: 400 })
    const teams = await loadTeams(day, driver ? [driver] : undefined)
    if (driver && !teams.length) return NextResponse.json({ error: 'Équipe introuvable' }, { status: 404 })
    const pdf = driver ? await buildTeamPdf(teams[0]) : await buildDayPdf(day, teams)
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="planning_${day}${driver ? '_' + driver : ''}.pdf"` } })
  } catch (e) { return fail(e) }
}
