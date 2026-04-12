import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  try {
    const session = await getSession(req)
    if (!session) {
      return NextResponse.json({ user: null }, { status: 200 })
    }

    const tenant = session.tenantId
      ? await prisma.tenant.findUnique({ where: { id: session.tenantId }, select: { id: true, name: true, slug: true, primaryColor: true, logoUrl: true } })
      : null

    return NextResponse.json({
      user: {
        id:       session.userId,
        email:    session.email,
        name:     session.name,
        role:     session.role,
        tenantId: session.tenantId,
      },
      tenant,
    })
  } catch (e) {
    console.error('[auth/me]', e)
    return NextResponse.json({ user: null }, { status: 200 })
  }
}
