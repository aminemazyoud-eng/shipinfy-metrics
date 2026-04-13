import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, roleAtLeast } from '@/lib/auth'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

// POST /api/support/[id]/resolve — Résoudre un ticket (status → resolu, resolvedAt = NOW())
// Requiert: SUPPORT minimum
export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!roleAtLeast(session.role, 'SUPPORT')) {
      return NextResponse.json({ error: 'Rôle insuffisant (SUPPORT requis)' }, { status: 403 })
    }

    const { id } = await ctx.params
    const resolvedAt = new Date()

    // Compute SLA breached: was ticket open more than 24h before resolution?
    const existing = await prisma.supportTicket.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Ticket introuvable' }, { status: 404 })

    const ageH = (resolvedAt.getTime() - new Date(existing.createdAt).getTime()) / 3600000
    const slaBreached = ageH > 24

    const ticket = await prisma.supportTicket.update({
      where: { id },
      data: {
        status:     'resolu',
        resolvedAt,
        slaBreached,
      },
    })

    return NextResponse.json(ticket)
  } catch (e) {
    console.error('[api/support/[id]/resolve POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
