import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, roleAtLeast, ROLES } from '@/lib/auth'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

// PATCH /api/admin/users/[id] — update role, active, name (SUPER_ADMIN only)
export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const session = await getSession(req)
    if (!session || !roleAtLeast(session.role, 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await ctx.params
    const body = await req.json() as { role?: string; active?: boolean; name?: string }

    const data: { role?: string; active?: boolean; name?: string } = {}
    if (body.role !== undefined) {
      if (!(ROLES as readonly string[]).includes(body.role)) {
        return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 })
      }
      data.role = body.role
    }
    if (body.active !== undefined) data.active = body.active
    if (body.name   !== undefined) data.name   = body.name

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, tenantId: true, active: true, createdAt: true },
    })
    return NextResponse.json(user)
  } catch (e) {
    console.error('[admin/users PATCH]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

// DELETE /api/admin/users/[id] — soft deactivate (SUPER_ADMIN only)
export async function DELETE(req: Request, ctx: RouteCtx) {
  try {
    const session = await getSession(req)
    if (!session || !roleAtLeast(session.role, 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await ctx.params
    if (id === session.userId) {
      return NextResponse.json({ error: 'Impossible de désactiver son propre compte' }, { status: 400 })
    }
    const user = await prisma.user.update({
      where: { id },
      data:  { active: false },
      select: { id: true, email: true, name: true, role: true, tenantId: true, active: true, createdAt: true },
    })
    return NextResponse.json(user)
  } catch (e) {
    console.error('[admin/users DELETE]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
