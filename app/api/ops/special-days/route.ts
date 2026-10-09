import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { validateSpecialDay, type SpecialDay } from '@/lib/ops-special-days'
import { bumpOpsEpoch } from '@/lib/ops-cache'
import { localToday, addDays } from '@/lib/tz'

// GET /api/ops/special-days?from=YYYY-MM-DD — liste des jours spéciaux (défaut : depuis 30 jours) — MANAGER
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const from = /^\d{4}-\d\d-\d\d$/.test(sp.get('from') ?? '') ? (sp.get('from') as string) : addDays(localToday(), -30)
    const rows = await prisma.opsSpecialDay.findMany({ where: { day: { gte: from } }, orderBy: { day: 'asc' }, take: 500, select: { day: true, label: true, kind: true, factor: true } })
    return NextResponse.json({ days: rows, canEdit: ['ADMIN', 'SUPER_ADMIN'].includes(auth.session.role) })
  } catch (e) { return fail(e) }
}

// POST /api/ops/special-days (ADMIN) — { day, label, kind, factor } ou { items: [...] } (max 100) ; crée ou remplace le jour
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as Partial<SpecialDay> & { items?: Partial<SpecialDay>[] }
    const items = Array.isArray(b.items) ? b.items : [b]
    if (!items.length || items.length > 100) return NextResponse.json({ error: '1 à 100 jours par envoi' }, { status: 400 })
    for (const it of items) { const err = validateSpecialDay(it); if (err) return NextResponse.json({ error: `${it.day ?? '?'} : ${err}` }, { status: 400 }) }
    for (const it of items) {
      const label = String(it.label).trim(), factor = Number(it.factor)
      const data = { label, kind: String(it.kind), factor }
      await prisma.opsSpecialDay.upsert({ where: { day: it.day as string }, update: data, create: { day: it.day as string, ...data } })
    }
    bumpOpsEpoch()
    await audit(auth.session, 'special_day.set', 'config', items.length === 1 ? (items[0].day as string) : null, { count: items.length, items: items.slice(0, 20) })
    return NextResponse.json({ ok: true, saved: items.length })
  } catch (e) { return fail(e) }
}

// DELETE /api/ops/special-days?day=YYYY-MM-DD (ADMIN)
export async function DELETE(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const day = new URL(req.url).searchParams.get('day') ?? ''
    if (!/^\d{4}-\d\d-\d\d$/.test(day)) return NextResponse.json({ error: 'Date invalide (AAAA-MM-JJ)' }, { status: 400 })
    const n = (await prisma.opsSpecialDay.deleteMany({ where: { day } })).count
    bumpOpsEpoch()
    await audit(auth.session, 'special_day.delete', 'config', day, { deleted: n })
    return NextResponse.json({ ok: true, deleted: n })
  } catch (e) { return fail(e) }
}
