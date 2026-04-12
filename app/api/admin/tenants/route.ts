import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, roleAtLeast } from '@/lib/auth'

// GET /api/admin/tenants — list all tenants with user count (SUPER_ADMIN)
export async function GET(req: Request) {
  try {
    const session = await getSession(req)
    if (!session || !roleAtLeast(session.role, 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true } } },
    })
    return NextResponse.json(tenants)
  } catch (e) {
    console.error('[admin/tenants GET]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

// POST /api/admin/tenants — create tenant (SUPER_ADMIN)
export async function POST(req: Request) {
  try {
    const session = await getSession(req)
    if (!session || !roleAtLeast(session.role, 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { name, slug, logoUrl, primaryColor, plan } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'name et slug requis' }, { status: 400 })
    }

    const slugClean = (slug as string).toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const existing  = await prisma.tenant.findUnique({ where: { slug: slugClean } })
    if (existing) {
      return NextResponse.json({ error: 'slug déjà utilisé' }, { status: 409 })
    }

    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug:         slugClean,
        logoUrl:      logoUrl      ?? null,
        primaryColor: primaryColor ?? '#2563eb',
        plan:         plan         ?? 'basic',
        active:       true,
      },
    })
    return NextResponse.json({ ...tenant, _count: { users: 0 } }, { status: 201 })
  } catch (e) {
    console.error('[admin/tenants POST]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
