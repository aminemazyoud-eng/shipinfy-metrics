import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, hashPassword, roleAtLeast } from '@/lib/auth'

// GET /api/admin/users?tenantId=xxx  — list users (SUPER_ADMIN only)
export async function GET(req: Request) {
  try {
    const session = await getSession(req)
    if (!session || !roleAtLeast(session.role, 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const users = await prisma.user.findMany({
      where: tenantId ? { tenantId } : {},
      select: { id: true, email: true, name: true, role: true, tenantId: true, active: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(users)
  } catch (e) {
    console.error('[admin/users GET]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

// POST /api/admin/users — create user (SUPER_ADMIN only)
export async function POST(req: Request) {
  try {
    const session = await getSession(req)
    if (!session || !roleAtLeast(session.role, 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { email, password, name, role, tenantId } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'email et password requis' }, { status: 400 })
    }
    if ((password as string).length < 6) {
      return NextResponse.json({ error: 'Mot de passe minimum 6 caractères' }, { status: 400 })
    }

    const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'VIEWER']
    const userRole = VALID_ROLES.includes(role) ? role : 'VIEWER'

    const user = await prisma.user.create({
      data: {
        email:    (email as string).toLowerCase().trim(),
        password: hashPassword(password),
        name:     name ?? null,
        role:     userRole,
        tenantId: tenantId ?? null,
        active:   true,
      },
      select: { id: true, email: true, name: true, role: true, tenantId: true, active: true, createdAt: true },
    })
    return NextResponse.json(user, { status: 201 })
  } catch (e: unknown) {
    const msg = (e as Error).message ?? ''
    if (msg.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Email déjà utilisé' }, { status: 409 })
    }
    console.error('[admin/users POST]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
