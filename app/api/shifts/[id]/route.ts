import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/ops-auth'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

// PATCH /api/shifts/[id]
export async function PATCH(req: Request, ctx: RouteCtx) {
  const _guard = await requireSession(req, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const { id }  = await ctx.params
    const body    = await req.json()

    const slot = await prisma.shiftSlot.update({
      where: { id },
      data: {
        ...(body.zone        !== undefined && { zone:        body.zone        }),
        ...(body.startTime   !== undefined && { startTime:   body.startTime   }),
        ...(body.endTime     !== undefined && { endTime:     body.endTime     }),
        ...(body.maxDrivers  !== undefined && { maxDrivers:  body.maxDrivers  }),
        ...(body.minDrivers  !== undefined && { minDrivers:  body.minDrivers  }),
        ...(body.premiumOnly !== undefined && { premiumOnly: body.premiumOnly }),
      },
      include: { assignments: true },
    })
    await audit(_guard.session, 'shift.update', 'shiftSlot', id, { fields: ['zone', 'startTime', 'endTime', 'maxDrivers', 'minDrivers', 'premiumOnly'].filter(k => body[k] !== undefined) })
    return NextResponse.json(slot)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// DELETE /api/shifts/[id]
export async function DELETE(_req: Request, ctx: RouteCtx) {
  const _guard = await requireSession(_req, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const { id } = await ctx.params
    await prisma.shiftSlot.delete({ where: { id } })
    await audit(_guard.session, 'shift.delete', 'shiftSlot', id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
