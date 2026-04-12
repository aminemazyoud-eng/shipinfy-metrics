import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canAccessSlot } from '@/lib/shift-engine'

export const runtime = 'nodejs'

// GET /api/shifts/available?driverName=xxx&week=YYYY-MM-DD
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const driverName = searchParams.get('driverName')
    const week       = searchParams.get('week')

    if (!driverName) {
      return NextResponse.json({ error: 'driverName requis' }, { status: 400 })
    }

    // Récupérer score IA
    const scoreRecord = await prisma.reliabilityScore.findFirst({
      where:   { driverName },
      orderBy: { calculatedAt: 'desc' },
    })
    const scoreIA = scoreRecord?.score ?? 50

    // Filtrer par semaine si fourni
    let dateFilter = {}
    if (week) {
      const start = new Date(week)
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      end.setHours(23, 59, 59, 999)
      dateFilter = { date: { gte: start, lte: end } }
    } else {
      // Défaut : 7 prochains jours
      const now = new Date()
      const end = new Date(now)
      end.setDate(end.getDate() + 7)
      dateFilter = { date: { gte: now, lte: end } }
    }

    const slots = await prisma.shiftSlot.findMany({
      where:   dateFilter,
      include: { assignments: true },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    })

    const now = new Date()

    // Filtrer selon règles de priorisation
    const available = slots.filter(slot => {
      // Slot déjà plein
      if (slot.assignments.length >= slot.maxDrivers) return false
      // Livreur déjà assigné
      if (slot.assignments.some(a => a.driverName === driverName)) return false
      // Fenêtre d'accès selon score
      return canAccessSlot(scoreIA, slot.date, now)
    })

    return NextResponse.json({
      driverName,
      scoreIA,
      slots: available,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
