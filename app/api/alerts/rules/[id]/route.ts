import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json()
  const { threshold, enabled } = body

  try {
    const rule = await (prisma as any).alertRule.update({
      where: { id },
      data: {
        ...(threshold !== undefined && { threshold: Number(threshold) }),
        ...(enabled !== undefined && { enabled: Boolean(enabled) }),
      },
    })
    return NextResponse.json(rule)
  } catch (e) {
    return NextResponse.json({ error: 'Règle non trouvée' }, { status: 404 })
  }
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id } = await ctx.params
  try {
    const rule = await (prisma as any).alertRule.findFirst({ where: { id } })
    if (!rule) return NextResponse.json({ error: 'Non trouvée' }, { status: 404 })
    return NextResponse.json(rule)
  } catch (e) {
    return NextResponse.json({ error: 'Erreur' }, { status: 500 })
  }
}
