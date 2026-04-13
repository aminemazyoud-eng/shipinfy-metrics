import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

// POST /api/support/[id]/satisfaction — enregistrer le score de satisfaction (sans auth — lien client)
export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    const body = await req.json() as { score: number; comment?: string }

    const { score, comment } = body

    if (!score || typeof score !== 'number' || score < 1 || score > 5) {
      return NextResponse.json({ error: 'score doit être entre 1 et 5' }, { status: 400 })
    }

    const ticket = await prisma.supportTicket.update({
      where: { id },
      data: {
        satisfactionScore:   Math.round(score),
        satisfactionComment: comment ?? null,
      },
    })

    return NextResponse.json(ticket)
  } catch (e) {
    console.error('[api/support/[id]/satisfaction POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
