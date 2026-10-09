import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-guard'
import { assertSafeUrl } from '@/lib/safe-fetch'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

// PATCH /api/n8n/config/[id] (ADMIN) — ne renvoie jamais le secret
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const auth = await requireSession(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    const body   = await req.json()

    if (body.webhookUrl !== undefined) {
      try { await assertSafeUrl(String(body.webhookUrl)) } catch (e) {
        return NextResponse.json({ error: `URL de webhook refusée : ${e instanceof Error ? e.message : 'invalide'}` }, { status: 400 })
      }
    }

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
    const { secret, ...safe } = config
    return NextResponse.json({ ...safe, hasSecret: !!secret })
  } catch (e) {
    console.error('[api/n8n/config PATCH]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// DELETE /api/n8n/config/[id] (ADMIN)
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const auth = await requireSession(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    await prisma.n8NConfig.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/n8n/config DELETE]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
