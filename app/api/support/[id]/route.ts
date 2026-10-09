import { requireSession } from '@/lib/api-guard'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/ops-auth'

type RouteCtx = { params: Promise<{ id: string }> }

// PATCH /api/support/[id] — mettre à jour le statut / assignation
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const _guard = await requireSession(req, 'SUPPORT'); if ('error' in _guard) return _guard.error
  try {
    const { id } = await ctx.params
    const body = await req.json() as {
      status?: string; assignedTo?: string; priority?: string
      resolvedAt?: string | null
    }

    const ticket = await prisma.supportTicket.update({
      where: { id },
      data: {
        status:     body.status     ?? undefined,
        assignedTo: body.assignedTo ?? undefined,
        priority:   body.priority   ?? undefined,
        resolvedAt: body.resolvedAt === null
          ? null
          : body.resolvedAt
            ? new Date(body.resolvedAt)
            : undefined,
      },
    })

    await audit(_guard.session, 'support.update', 'supportTicket', id, { status: body.status, priority: body.priority, assignedTo: body.assignedTo, resolvedAtChanged: body.resolvedAt !== undefined })
    return NextResponse.json(ticket)
  } catch (e) {
    console.error('[api/support/[id] PATCH]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
