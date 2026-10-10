import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { listReasons, reasonForOrder, validateReasonInput } from '@/lib/ops-reasons'

export const dynamic = 'force-dynamic'

// GET /api/ops/reasons — nomenclature complète (MANAGER). Avec ?orderId=… : motif de non-livraison de cette commande (détail commande côté bureau).
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const orderId = new URL(req.url).searchParams.get('orderId')
    if (orderId) return NextResponse.json({ reason: await reasonForOrder(orderId) })
    return NextResponse.json({ reasons: await listReasons(), canEdit: ['ADMIN', 'SUPER_ADMIN'].includes(auth.session.role) })
  } catch (e) { return fail(e) }
}

// POST /api/ops/reasons (ADMIN) — crée un motif { code, label, labelAr?, kind?, cod?, rto?, sort?, active? }
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const v = validateReasonInput(await req.json().catch(() => null))
    if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })
    const { prisma } = await import('@/lib/prisma')
    await listReasons() // sème la liste par défaut avant d'ajouter (sinon le semis sauterait : la table ne serait plus vide)
    if (await prisma.opsReason.findUnique({ where: { code: v.data.code! } })) return NextResponse.json({ error: 'Ce code existe déjà' }, { status: 409 })
    const row = await prisma.opsReason.create({ data: { code: v.data.code!, label: v.data.label!, labelAr: v.data.labelAr ?? null, kind: v.data.kind ?? 'NON_DELIVERY', cod: v.data.cod ?? false, rto: v.data.rto ?? true, sort: v.data.sort ?? 100, active: v.data.active ?? true } })
    await audit(auth.session, 'reason.create', 'config', row.code, v.data)
    return NextResponse.json({ ok: true, reason: row }, { status: 201 })
  } catch (e) { return fail(e) }
}

// PUT /api/ops/reasons (ADMIN) — { code, ...champs à modifier } ; le code lui-même n'est pas modifiable (il est référencé par les commandes)
export async function PUT(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const code = typeof body?.code === 'string' ? body.code : ''
    const { code: _ignored, ...rest } = body ?? {}
    void _ignored
    const v = validateReasonInput(rest, true)
    if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })
    const { prisma } = await import('@/lib/prisma')
    if (!code || !(await prisma.opsReason.findUnique({ where: { code } }))) return NextResponse.json({ error: 'Motif introuvable' }, { status: 404 })
    const row = await prisma.opsReason.update({ where: { code }, data: v.data })
    await audit(auth.session, 'reason.update', 'config', code, v.data)
    return NextResponse.json({ ok: true, reason: row })
  } catch (e) { return fail(e) }
}

// DELETE /api/ops/reasons?code=… (ADMIN) — supprime le motif ; s'il est déjà utilisé par des commandes, il est seulement désactivé (historique conservé)
export async function DELETE(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const code = new URL(req.url).searchParams.get('code') ?? ''
    const { prisma } = await import('@/lib/prisma')
    if (!code || !(await prisma.opsReason.findUnique({ where: { code } }))) return NextResponse.json({ error: 'Motif introuvable' }, { status: 404 })
    const used = await prisma.opsOrder.count({ where: { reasonCode: code } })
    if (used > 0) {
      await prisma.opsReason.update({ where: { code }, data: { active: false } })
      await audit(auth.session, 'reason.deactivate', 'config', code, { used })
      return NextResponse.json({ ok: true, deactivated: true, used })
    }
    await prisma.opsReason.delete({ where: { code } })
    await audit(auth.session, 'reason.delete', 'config', code)
    return NextResponse.json({ ok: true, deleted: true })
  } catch (e) { return fail(e) }
}
