import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type RouteCtx = { params: Promise<{ id: string }> }

// PATCH /api/pointage/[id] — mettre à jour checkOut ou status
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    const body = await req.json() as {
      checkOut?: string; status?: string; notes?: string; hub?: string
    }

    const record = await prisma.driverAttendance.update({
      where: { id },
      data: {
        checkOut: body.checkOut ? new Date(body.checkOut) : undefined,
        status:   body.status  ?? undefined,
        notes:    body.notes   ?? undefined,
        hub:      body.hub     ?? undefined,
      },
    })

    return NextResponse.json(record)
  } catch (e) {
    console.error('[api/pointage/[id] PATCH]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// DELETE /api/pointage/[id]
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params
    await prisma.driverAttendance.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/pointage/[id] DELETE]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
