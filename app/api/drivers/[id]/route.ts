import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(_: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const driver = await prisma.driver.findUnique({
      where: { id },
      include: {
        onboardingSteps: { orderBy: { step: 'asc' } },
        courseProgress:  { include: { course: true } },
      },
    })
    if (!driver) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(driver)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const body = await req.json()
    // If updating a step status
    if (body.stepId) {
      const step = await prisma.onboardingStep.update({
        where: { id: body.stepId },
        data: {
          status:      body.status,
          notes:       body.notes ?? undefined,
          completedAt: body.status === 'validated' ? new Date() : null,
        },
      })
      // Recalculate driver status based on steps
      const allSteps = await prisma.onboardingStep.findMany({ where: { driverId: id } })
      const validated = allSteps.filter(s => s.status === 'validated').length
      let driverStatus = 'en_cours'
      if (validated === 0) driverStatus = 'prospect'
      else if (validated < 3) driverStatus = 'en_cours'
      else if (validated < 5) driverStatus = 'formation'
      else driverStatus = 'valide'

      await prisma.driver.update({ where: { id }, data: { status: driverStatus } })
      return NextResponse.json(step)
    }
    // Otherwise update driver fields
    const driver = await prisma.driver.update({
      where: { id },
      data: {
        firstName:        body.firstName        ?? undefined,
        lastName:         body.lastName         ?? undefined,
        phone:            body.phone            ?? undefined,
        email:            body.email            ?? undefined,
        city:             body.city             ?? undefined,
        status:           body.status           ?? undefined,
        notes:            body.notes            ?? undefined,
        reliabilityScore: body.reliabilityScore ?? undefined,
      },
    })
    return NextResponse.json(driver)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(_: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    await prisma.driver.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
