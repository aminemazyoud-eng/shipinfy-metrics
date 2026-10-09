import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, hashPassword, roleAtLeast, MIN_PASSWORD_LENGTH } from '@/lib/auth'
import { randomBytes } from 'crypto'
import { audit } from '@/lib/ops-auth'

type RouteCtx = { params: Promise<{ id: string }> }

// GET /api/admin/tenants/[id]/users — users for a tenant (SUPER_ADMIN)
export async function GET(req: Request, ctx: RouteCtx) {
  try {
    const session = await getSession(req)
    if (!session || !roleAtLeast(session.role, 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await ctx.params
    const users = await prisma.user.findMany({
      where:   { tenantId: id },
      select:  { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(users)
  } catch (e) {
    console.error('[admin/tenants/users GET]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

// POST /api/admin/tenants/[id]/users — add user to tenant (SUPER_ADMIN)
export async function POST(req: Request, ctx: RouteCtx) {
  try {
    const session = await getSession(req)
    if (!session || !roleAtLeast(session.role, 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await ctx.params
    const body   = await req.json()
    const { email, name, role, password } = body

    if (!email) {
      return NextResponse.json({ error: 'email requis' }, { status: 400 })
    }
    if (password && String(password).length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `Mot de passe minimum ${MIN_PASSWORD_LENGTH} caractères` }, { status: 400 })
    }
    // Sans mot de passe fourni : mot de passe aléatoire inconnu de tous → l'utilisateur passe par « Mot de passe oublié »
    const initialPassword: string = password ? String(password) : randomBytes(24).toString('base64url')

    const tenant = await prisma.tenant.findUnique({ where: { id } })
    if (!tenant) return NextResponse.json({ error: 'tenant introuvable' }, { status: 404 })

    const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'VIEWER']
    const userRole = VALID_ROLES.includes(role) ? role : 'VIEWER'

    const user = await prisma.user.upsert({
      where:  { email: (email as string).toLowerCase().trim() },
      update: { name, role: userRole, tenantId: id, active: true },
      create: {
        email:    (email as string).toLowerCase().trim(),
        password: hashPassword(initialPassword),
        name:     name ?? null,
        role:     userRole,
        tenantId: id,
        active:   true,
      },
      select: { id: true, email: true, name: true, role: true, tenantId: true, active: true, createdAt: true },
    })
    await audit(session, 'admin.user_create', 'User', user.id, { tenantId: id, role: userRole, via: 'tenant_users_upsert' })
    return NextResponse.json(user, { status: 201 })
  } catch (e) {
    console.error('[admin/tenants/users POST]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
