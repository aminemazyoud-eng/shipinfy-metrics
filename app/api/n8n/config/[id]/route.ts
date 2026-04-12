import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

// PATCH /api/n8n/config/[id]
export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    const body   = await req.json()

    const config = await prisma.n8NConfig.update({
      where: { id },
      data: {
        ...(body.name       !== undefined && { name:       body.name       }),
        ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl }),
        ...(body.eventType  !== undefined && { eventType:  body.eventType  }),
        ...(body.secret     !== undefined && { secret:     body.secret     }),
        ...(body.active     !== undefined && { active:     body.active     }),
      },
    })
    return NextResponse.json(config)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// DELETE /api/n8n/config/[id]
export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    await prisma.n8NConfig.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
