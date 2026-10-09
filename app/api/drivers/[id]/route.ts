import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { triggerN8N } from '@/lib/n8n-bridge'
import { audit } from '@/lib/ops-auth'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(_: Request, { params }: RouteCtx) {
  const _guard = await requireSession(_, 'VIEWER'); if ('error' in _guard) return _guard.error
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
  const _guard = await requireSession(req, 'DISPATCHER'); if ('error' in _guard) return _guard.error
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

      const updatedDriver = await prisma.driver.update({ where: { id }, data: { status: driverStatus } })

      // Sprint 11 — notify N8N when driver reaches "valide" (fully onboarded)
      if (driverStatus === 'valide') {
        triggerN8N('driver_onboarded', {
          driverId:   id,
          driverName: `${updatedDriver.firstName} ${updatedDriver.lastName}`,
          phone:      updatedDriver.phone,
          city:       updatedDriver.city ?? null,
          status:     driverStatus,
        }).catch(() => {})
      }

      await audit(_guard.session, 'driver.onboarding_step', 'driver', id, { stepId: body.stepId, step: step.step, status: step.status, driverStatus })
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
    // Journal : uniquement les NOMS des champs modifiés (jamais téléphone / e-mail / notes)
    const changed = ['firstName', 'lastName', 'phone', 'email', 'city', 'status', 'notes', 'reliabilityScore'].filter(k => body[k] != null)
    await audit(_guard.session, 'driver.update', 'driver', id, { fields: changed, status: body.status ?? undefined })
    return NextResponse.json(driver)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(_: Request, { params }: RouteCtx) {
  const _guard = await requireSession(_, 'DISPATCHER'); if ('error' in _guard) return _guard.error
  try {
    const { id } = await params
    await prisma.driver.delete({ where: { id } })
    await audit(_guard.session, 'driver.delete', 'driver', id)
    return NextResponse.json({ deleted: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
