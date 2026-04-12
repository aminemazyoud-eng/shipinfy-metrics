import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type RouteCtx = { params: Promise<{ id: string }> }

// PATCH /api/admin/tenants/[id] — update name, plan, active, primaryColor, logoUrl
export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    const body   = await req.json()

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...(body.name         !== undefined && { name:         body.name         }),
        ...(body.plan         !== undefined && { plan:         body.plan         }),
        ...(body.active       !== undefined && { active:       body.active       }),
        ...(body.primaryColor !== undefined && { primaryColor: body.primaryColor }),
        ...(body.logoUrl      !== undefined && { logoUrl:      body.logoUrl      }),
      },
    })
    return NextResponse.json(tenant)
  } catch (e) {
    console.error('[admin/tenants PATCH]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

// DELETE /api/admin/tenants/[id] — hard delete (cascades users)
export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    await prisma.tenant.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/tenants DELETE]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
