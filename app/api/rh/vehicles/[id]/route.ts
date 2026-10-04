import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'

// PATCH /api/rh/vehicles/:id (ADMIN) — modification d'un véhicule (seul l'admin peut modifier)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    const b = await req.json() as Record<string, unknown>
    const s = (k: string) => (b[k] === undefined ? undefined : b[k] === '' || b[k] === null ? null : String(b[k]))
    const n = (k: string) => (b[k] === undefined ? undefined : b[k] === '' || b[k] === null ? null : Number(b[k]))
    const dt = (k: string) => (b[k] === undefined ? undefined : b[k] ? new Date(String(b[k])) : null)
    const hub = b.hubCode ? await prisma.opsHub.findUnique({ where: { code: String(b.hubCode) } }) : undefined
    if (b.status !== undefined && !['active', 'maintenance', 'out_of_service'].includes(String(b.status))) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    const v = await prisma.opsVehicle.update({
      where: { id },
      data: { plate: s('plate') ?? undefined, type: s('type') ?? undefined, fuelType: s('fuelType') ?? undefined, brand: s('brand'), model: s('model'), year: n('year'), registrationNo: s('registrationNo'),
        status: s('status') ?? undefined, capacityKg: n('capacityKg'), consumptionL100: n('consumptionL100'), insuranceExpiry: dt('insuranceExpiry'), technicalVisitExpiry: dt('technicalVisitExpiry'), ...(hub ? { hubId: hub.id } : {}) },
    })
    await audit(auth.session, 'rh.vehicle_update', 'vehicle', v.plate, Object.keys(b))
    return NextResponse.json({ ok: true })
  } catch (e) { return fail(e) }
}
