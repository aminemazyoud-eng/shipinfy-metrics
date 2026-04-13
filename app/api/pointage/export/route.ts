import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, roleAtLeast } from '@/lib/auth'

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
    const today = new Date()
    const month = monthParam ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

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
    const lines: string[] = ['Livreur,Jours présents,Absences,Retards,Taux présence']
    for (const [driver, recs] of byDriver.entries()) {
      const present  = recs.filter(r => r.status === 'present').length
      const late     = recs.filter(r => r.status === 'late').length
      const absent   = recs.filter(r => r.status === 'absent').length
      const total    = recs.length
      const rate     = total > 0 ? Math.round(((present + late) / total) * 100) : 0
      lines.push(`"${driver}",${present + late},${absent},${late},${rate}%`)
    }

    const csv = lines.join('\n')
    const filename = `pointage_${month}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    console.error('[api/pointage/export GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
