import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { loadSectors, validateSectorInput, invalidateSectors } from '@/lib/ops-sectors'
import { dayOfTz, dayBoundsTz } from '@/lib/tz'
import { bumpOpsEpoch } from '@/lib/ops-cache'

export const dynamic = 'force-dynamic'

// GET /api/ops/sectors?day=today → { sectors: [{ id, code, name, hubCode, polygon:[[lat,lng],…], active, ordersToday }], hubs:[{code,name,lat,lng}] }
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const day = dayOfTz(new URL(req.url).searchParams.get('day'))
    const { from, to } = dayBoundsTz(day)
    const [sectors, counts, hubs] = await Promise.all([
      loadSectors(true),
      prisma.opsOrder.groupBy({ by: ['sectorCode'], where: { slotStart: { gte: from, lt: to }, sectorCode: { not: null } }, _count: { _all: true } }),
      prisma.opsHub.findMany({ where: { active: true }, select: { code: true, name: true, lat: true, lng: true }, orderBy: { code: 'asc' } }),
    ])
    const cnt = new Map(counts.map(c => [c.sectorCode, c._count._all]))
    const untagged = await prisma.opsOrder.count({ where: { slotStart: { gte: from, lt: to }, sectorCode: null } })
    return NextResponse.json({ day, sectors: sectors.map(s => ({ ...s, ordersToday: cnt.get(s.code) ?? 0 })), untagged, hubs })
  } catch (e) { return fail(e) }
}

// POST /api/ops/sectors { id?, code, name, hubCode?, polygon:[[lat,lng],…] | "lat,lng\n…", active? } — crée ou met à jour (par id, sinon par code)
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const v = validateSectorInput(await req.json().catch(() => null))
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    const { id, code, name, hubCode, polygon, active } = v.value
    const existing = id ? await prisma.opsSector.findUnique({ where: { id } }) : await prisma.opsSector.findUnique({ where: { code } })
    if (existing && existing.code !== code && (await prisma.opsSector.findUnique({ where: { code } }))) return NextResponse.json({ error: 'Ce code est déjà utilisé' }, { status: 409 })
    const data = { code, name, hubCode, polygon: JSON.stringify(polygon), active }
    const row = existing ? await prisma.opsSector.update({ where: { id: existing.id }, data }) : await prisma.opsSector.create({ data })
    invalidateSectors(); bumpOpsEpoch()
    await audit(auth.session, existing ? 'sector.update' : 'sector.create', 'sector', row.id, { code, name, hubCode, points: polygon.length, active }, hubCode)
    return NextResponse.json({ ok: true, id: row.id })
  } catch (e) { return fail(e) }
}

// DELETE /api/ops/sectors?id= — supprime le secteur (les commandes gardent leur ancien code jusqu'au prochain recalcul)
export async function DELETE(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    const row = await prisma.opsSector.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Secteur introuvable' }, { status: 404 })
    await prisma.opsSector.delete({ where: { id } })
    invalidateSectors(); bumpOpsEpoch()
    await audit(auth.session, 'sector.delete', 'sector', id, { code: row.code }, row.hubCode)
    return NextResponse.json({ ok: true })
  } catch (e) { return fail(e) }
}
