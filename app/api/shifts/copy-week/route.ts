import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export const runtime = 'nodejs'

// POST /api/shifts/copy-week — copier tous les ShiftSlots d'une semaine vers la suivante
export async function POST(req: Request) {
  try {
    // Auth — COORDINATOR minimum
    const session = await getSession(req)
    if (!session) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }
    const allowedRoles = ['COORDINATOR', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']
    if (!allowedRoles.includes(session.role ?? '')) {
      return NextResponse.json({ error: 'Droits insuffisants (COORDINATOR requis)' }, { status: 403 })
    }

    const body = await req.json() as { weekStart: string }
    const { weekStart } = body

    if (!weekStart) {
      return NextResponse.json({ error: 'weekStart (YYYY-MM-DD) requis' }, { status: 400 })
    }

    // Calcul de la plage de la semaine source
    const start = new Date(weekStart)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    end.setHours(23, 59, 59, 999)

    // Calcul de la semaine cible (+7 jours)
    const targetStart = new Date(start)
    targetStart.setDate(targetStart.getDate() + 7)
    const targetEnd = new Date(end)
    targetEnd.setDate(targetEnd.getDate() + 7)

    // Vérifier que la semaine cible n'a pas déjà des shifts
    const existing = await prisma.shiftSlot.count({
      where: { date: { gte: targetStart, lte: targetEnd } },
    })

    if (existing > 0) {
      return NextResponse.json(
        { error: `La semaine cible contient déjà ${existing} shift(s). Supprimez-les d'abord.` },
        { status: 409 },
      )
    }

    // Récupérer les slots de la semaine source
    const sourceSlots = await prisma.shiftSlot.findMany({
      where: { date: { gte: start, lte: end } },
    })

    if (sourceSlots.length === 0) {
      return NextResponse.json({ error: 'Aucun shift trouvé pour cette semaine' }, { status: 404 })
    }

    // Cloner avec date +7 jours, sans assignations
    const newSlots = await Promise.all(
      sourceSlots.map(slot => {
        const newDate = new Date(slot.date)
        newDate.setDate(newDate.getDate() + 7)
        return prisma.shiftSlot.create({
          data: {
            zone:        slot.zone,
            date:        newDate,
            startTime:   slot.startTime,
            endTime:     slot.endTime,
            maxDrivers:  slot.maxDrivers,
            minDrivers:  slot.minDrivers,
            premiumOnly: slot.premiumOnly,
            tenantId:    slot.tenantId ?? null,
          },
        })
      }),
    )

    return NextResponse.json({
      copied:    newSlots.length,
      weekStart: targetStart.toISOString().slice(0, 10),
    })
  } catch (e) {
    console.error('[api/shifts/copy-week POST]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
