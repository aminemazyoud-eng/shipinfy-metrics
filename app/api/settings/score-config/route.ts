import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, roleAtLeast } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.tenantId) return NextResponse.json({ scoreCoeffDelivery: 0.4, scoreCoeffAcademy: 0.3, scoreCoeffNoShow: 0.3 })

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { scoreCoeffDelivery: true, scoreCoeffAcademy: true, scoreCoeffNoShow: true },
  })

  return NextResponse.json(tenant ?? { scoreCoeffDelivery: 0.4, scoreCoeffAcademy: 0.3, scoreCoeffNoShow: 0.3 })
}

export async function PATCH(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!roleAtLeast(session.role, 'MANAGER')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!session.tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

  const body = await req.json() as {
    scoreCoeffDelivery?: number
    scoreCoeffAcademy?: number
    scoreCoeffNoShow?: number
  }

  const { scoreCoeffDelivery, scoreCoeffAcademy, scoreCoeffNoShow } = body

  // Validate that each coefficient is between 0 and 1
  for (const [key, val] of Object.entries({ scoreCoeffDelivery, scoreCoeffAcademy, scoreCoeffNoShow })) {
    if (val !== undefined && (typeof val !== 'number' || val < 0 || val > 1)) {
      return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 })
    }
  }

  const updated = await prisma.tenant.update({
    where: { id: session.tenantId },
    data: {
      ...(scoreCoeffDelivery !== undefined && { scoreCoeffDelivery }),
      ...(scoreCoeffAcademy  !== undefined && { scoreCoeffAcademy }),
      ...(scoreCoeffNoShow   !== undefined && { scoreCoeffNoShow }),
    },
    select: {
      scoreCoeffDelivery: true,
      scoreCoeffAcademy: true,
      scoreCoeffNoShow: true,
    },
  })

  return NextResponse.json(updated)
}
