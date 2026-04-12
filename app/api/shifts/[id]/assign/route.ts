import { NextResponse } from 'next/server'
import { assignDriver } from '@/lib/shift-engine'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

// POST /api/shifts/[id]/assign — assigner un livreur
export async function POST(req: Request, ctx: RouteCtx) {
  try {
    const { id }       = await ctx.params
    const body         = await req.json()
    const { driverName } = body

    if (!driverName) {
      return NextResponse.json({ error: 'driverName requis' }, { status: 400 })
    }

    // Récupérer le score IA le plus récent pour ce livreur
    const scoreRecord = await prisma.reliabilityScore.findFirst({
      where:   { driverName },
      orderBy: { calculatedAt: 'desc' },
    })
    const scoreIA = scoreRecord?.score

    const result = await assignDriver(id, driverName, scoreIA)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Retourner le slot mis à jour
    const slot = await prisma.shiftSlot.findUnique({
      where:   { id },
      include: { assignments: { orderBy: { scoreIA: 'desc' } } },
    })
    return NextResponse.json(slot)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// DELETE /api/shifts/[id]/assign — désassigner un livreur
export async function DELETE(req: Request, ctx: RouteCtx) {
  try {
    const { id }       = await ctx.params
    const { searchParams } = new URL(req.url)
    const driverName   = searchParams.get('driverName')

    if (!driverName) {
      return NextResponse.json({ error: 'driverName requis' }, { status: 400 })
    }

    await prisma.shiftAssignment.deleteMany({ where: { slotId: id, driverName } })

    const slot = await prisma.shiftSlot.findUnique({
      where:   { id },
      include: { assignments: { orderBy: { scoreIA: 'desc' } } },
    })
    return NextResponse.json(slot)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
