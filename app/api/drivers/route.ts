import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const drivers = await prisma.driver.findMany({
      include: {
        onboardingSteps: true,
        courseProgress: { include: { course: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(drivers)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const driver = await prisma.driver.create({
      data: {
        firstName: body.firstName,
        lastName:  body.lastName,
        phone:     body.phone,
        email:     body.email ?? null,
        city:      body.city ?? null,
        status:    body.status ?? 'prospect',
        notes:     body.notes ?? null,
        onboardingSteps: {
          create: ['kyc_identity', 'kyc_vehicle', 'contract', 'training', 'equipment'].map(step => ({
            step,
            status: 'pending',
          })),
        },
      },
      include: { onboardingSteps: true },
    })
    return NextResponse.json(driver)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
