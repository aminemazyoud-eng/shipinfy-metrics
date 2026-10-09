import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, roleAtLeast } from '@/lib/auth'
import { xlsxResponse } from '@/lib/xlsx-response'
import { localToday } from '@/lib/tz'

export const runtime = 'nodejs'

// GET /api/pointage/export?month=YYYY-MM
// Retourne un CSV du rapport de présence mensuel
// Requiert: COORDINATOR minimum
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!roleAtLeast(session.role, 'COORDINATOR')) {
      return NextResponse.json({ error: 'Rôle insuffisant (COORDINATOR requis)' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const monthParam = searchParams.get('month') // YYYY-MM
    // Mois courant = mois LOCAL (Africa/Casablanca)
    const month = monthParam && /^\d{4}-\d\d$/.test(monthParam) ? monthParam : localToday().slice(0, 7)

    const [year, mon] = month.split('-').map(Number)
    const from = new Date(Date.UTC(year, mon - 1, 1))
    const to   = new Date(Date.UTC(year, mon, 1)) // exclusive

    const records = await prisma.driverAttendance.findMany({
      where: { date: { gte: from, lt: to } },
      orderBy: [{ driverName: 'asc' }, { date: 'asc' }],
    })

    // Group by driver
    const byDriver = new Map<string, typeof records>()
    for (const r of records) {
      if (!byDriver.has(r.driverName)) byDriver.set(r.driverName, [])
      byDriver.get(r.driverName)!.push(r)
    }

    // Build CSV
    const lines: string[] = ['Livreur,Jours présents,Absences,Retards,Minutes de retard,Heures travaillées,Taux présence']
    for (const [driver, recs] of byDriver.entries()) {
      const present  = recs.filter(r => r.status === 'present').length
      const late     = recs.filter(r => r.status === 'late').length
      const absent   = recs.filter(r => r.status === 'absent').length
      const total    = recs.length
      const rate     = total > 0 ? Math.round(((present + late) / total) * 100) : 0
      const lateMin = recs.reduce((s, r) => s + (r.lateMinutes ?? 0), 0)
      const hours = Math.round(recs.reduce((s, r) => s + (r.workedMinutes ?? 0), 0) / 6) / 10
      lines.push(`"${driver.replace(/"/g, '""')}",${present + late},${absent},${late},${lateMin},${hours},${rate}%`)
    }

    const csv = lines.join('\n')
    const filename = `pointage_${month}.csv`

    return xlsxResponse(csv, filename, 'Pointage')
  } catch (e) {
    console.error('[api/pointage/export GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
