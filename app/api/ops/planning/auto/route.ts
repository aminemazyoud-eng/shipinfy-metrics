import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { dayOfTz } from '@/lib/tz'
import { planDemand } from '@/lib/ops-planning-data'
import { attendanceByName } from '@/lib/ops-attendance'
import { proposePlanning } from '@/lib/ops-planning-auto'

export const dynamic = 'force-dynamic'

// GET /api/ops/planning/auto?day=YYYY-MM-DD|today&perTeam=25
// Propose les équipes de la journée (prévision de commandes par hub ÷ capacité d'une équipe) ; LECTURE SEULE — le dispatcher valide dans le planning.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const day = dayOfTz(sp.get('day'))
    const perTeam = Math.min(200, Math.max(5, Math.round(Number(sp.get('perTeam')) || 25)))
    const [demand, drivers, att, hubs] = await Promise.all([
      planDemand(day),
      prisma.opsDriver.findMany({ where: { status: 'active', jobType: 'chauffeur' }, select: { code: true, firstName: true, lastName: true, homeHubId: true, hubId: true } }),
      attendanceByName(day),
      prisma.opsHub.findMany({ select: { id: true, code: true } }),
    ])
    const hubCode = new Map(hubs.map(h => [h.id, h.code]))
    const hubDemand = Object.entries(demand).map(([hub, slots]) => ({ hub, forecast: Object.values(slots).reduce((s, n) => s + n, 0) }))
    const name = new Map(drivers.map(d => [d.code, `${d.firstName} ${d.lastName}`]))
    const proposal = proposePlanning(hubDemand, drivers.map(d => {
      const s = att.get(`${d.firstName} ${d.lastName}`)?.status
      return { code: d.code, homeHub: hubCode.get(d.homeHubId ?? d.hubId ?? '') ?? null, available: s !== 'absent' && s !== 'leave' }
    }), perTeam)
    return NextResponse.json({ day, perTeam, forecast: hubDemand, teams: proposal.teams.map(t => ({ ...t, name: name.get(t.driver) ?? t.driver })), shortfall: proposal.shortfall }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fail(e) }
}
