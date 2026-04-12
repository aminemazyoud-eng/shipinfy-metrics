import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type RouteCtx = { params: Promise<{ id: string }> }

// PATCH /api/alerts/delivery/[id]/ack  { ackBy?: string }
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    const body   = await req.json().catch(() => ({})) as { ackBy?: string }

    const updated = await prisma.deliveryAlert.update({
      where: { id },
      data: {
        acknowledged: true,
        ackAt:        new Date(),
        ackBy:        body.ackBy ?? 'Manager',
      },
    })

    return NextResponse.json(updated)
  } catch (e) {
    console.error('[api/alerts/delivery/ack PATCH]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
