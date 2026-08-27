import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ orderId: string }> }

const VALID = ['en_cours', 'pret', 'recupere'] as const
type PickingStatus = typeof VALID[number]

// PATCH /api/picking/[orderId] — Body: { status, pickerId? }
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const { orderId } = await ctx.params
    const body = await req.json() as { status?: string; pickerId?: string }

    if (!body.status || !VALID.includes(body.status as PickingStatus)) {
      return NextResponse.json({ error: 'status invalide (en_cours|pret|recupere)' }, { status: 400 })
    }
    const status = body.status as PickingStatus

    const order = await prisma.expressOrder.findUnique({ where: { id: orderId } })
    if (!order) {
      return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    }

    const now = new Date()
    const data: {
      pickingStatus: PickingStatus
      pickingStartAt?: Date
      pickingEndAt?: Date
      pickerId?: string
    } = { pickingStatus: status }

    if (status === 'en_cours' && !order.pickingStartAt) {
      data.pickingStartAt = now
    }
    if (status === 'pret' && !order.pickingEndAt) {
      data.pickingEndAt = now
    }
    if (body.pickerId) {
      data.pickerId = body.pickerId
    }

    const updated = await prisma.expressOrder.update({
      where: { id: orderId },
      data,
    })

    return NextResponse.json(updated)
  } catch (e) {
    console.error('[api/picking/[orderId] PATCH]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
