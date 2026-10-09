import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-guard'
import { audit } from '@/lib/ops-auth'

type RouteCtx = { params: Promise<{ id: string }> }

const PLANS = ['basic', 'pro', 'enterprise']

// PATCH /api/admin/tenants/[id] — update name, plan, active, primaryColor, logoUrl (SUPER_ADMIN)
export async function PATCH(req: Request, ctx: RouteCtx) {
  const _guard = await requireSession(req, 'SUPER_ADMIN'); if ('error' in _guard) return _guard.error
  try {
    const { id } = await ctx.params
    const body   = await req.json()

    if (body.plan !== undefined && !PLANS.includes(body.plan)) {
      return NextResponse.json({ error: 'Plan invalide (basic | pro | enterprise)' }, { status: 400 })
    }
    // logoUrl : https uniquement (ou vide pour retirer le logo)
    if (body.logoUrl !== undefined && body.logoUrl !== null && body.logoUrl !== '') {
      let ok = false
      try { ok = new URL(String(body.logoUrl)).protocol === 'https:' } catch { ok = false }
      if (!ok) return NextResponse.json({ error: 'logoUrl doit être une URL https://' }, { status: 400 })
    }

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...(body.name         !== undefined && { name:         body.name         }),
        ...(body.plan         !== undefined && { plan:         body.plan         }),
        ...(body.active       !== undefined && { active:       body.active       }),
        ...(body.primaryColor !== undefined && { primaryColor: body.primaryColor }),
        ...(body.logoUrl      !== undefined && { logoUrl:      body.logoUrl || null }),
      },
    })
    await audit(_guard.session, 'tenant.update', 'Tenant', id, { fields: Object.keys(body) })
    return NextResponse.json(tenant)
  } catch (e) {
    console.error('[admin/tenants PATCH]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

// DELETE /api/admin/tenants/[id] — suppression logique (active:false) ; les utilisateurs sont conservés
export async function DELETE(req: Request, ctx: RouteCtx) {
  const _guard = await requireSession(req, 'SUPER_ADMIN'); if ('error' in _guard) return _guard.error
  try {
    const { id } = await ctx.params
    await prisma.tenant.update({ where: { id }, data: { active: false } })
    await audit(_guard.session, 'tenant.deactivate', 'Tenant', id)
    return NextResponse.json({ ok: true, softDeleted: true })
  } catch (e) {
    console.error('[admin/tenants DELETE]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
