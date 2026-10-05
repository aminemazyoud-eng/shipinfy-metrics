import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { dayOf, attendanceKey } from '@/lib/ops-time'
import { slotLabels } from '@/lib/ops-slots'
import { fullName } from '@/lib/ops-attendance'
import { normalizePhone } from '@/lib/ops-planning'
import { whatsappConfigured } from '@/lib/whatsapp'

const DAY_RE = /^\d{4}-\d\d-\d\d$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// GET /api/ops/planning?day=tomorrow — planning d'un jour : lignes, chauffeurs planifiables (avec helper, hub d'origine, pointage), planning de la veille
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const day = dayOf(sp.get('day') || 'tomorrow')
    const prevDay = dayOf(day === dayOf('today') ? 'yesterday' : new Date(Date.parse(day + 'T12:00:00Z') - 86_400_000).toISOString().slice(0, 10))
    const [hubs, drivers, lines, plan, prev, att] = await Promise.all([
      prisma.opsHub.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
      prisma.opsDriver.findMany({ where: { jobType: 'chauffeur', status: { not: 'off' } }, orderBy: { code: 'asc' }, include: { vehicle: { include: { crew: { where: { jobType: 'helper', status: { not: 'off' } }, select: { firstName: true, lastName: true, phone: true } } } } } }),
      prisma.opsPlanLine.findMany({ where: { day } }),
      prisma.opsPlanDay.findUnique({ where: { day } }),
      prisma.opsPlanLine.findMany({ where: { day: prevDay } }),
      prisma.driverAttendance.findMany({ where: { date: attendanceKey(day) }, select: { driverName: true, status: true } }),
    ])
    const hubById = new Map(hubs.map(h => [h.id, h.code])), attBy = new Map(att.map(a => [a.driverName, a.status]))
    return NextResponse.json({
      day, status: plan?.status ?? 'draft', publishedAt: plan?.publishedAt ?? null, publishedBy: plan?.publishedBy ?? null, slots: slotLabels(), whatsapp: whatsappConfigured(), prevDay,
      hubs: hubs.map(h => ({ code: h.code, name: h.name, city: h.city })),
      drivers: drivers.map(d => ({
        code: d.code, name: fullName(d), phone: d.phone, phoneOk: !!normalizePhone(d.phone), homeHub: d.homeHubId ? hubById.get(d.homeHubId) ?? null : null, hub: d.hubId ? hubById.get(d.hubId) ?? null : null,
        vehicle: d.vehicle?.type ?? null, plate: d.vehicle?.plate ?? null, helpers: (d.vehicle?.crew ?? []).map(h => ({ name: `${h.firstName} ${h.lastName}`, phoneOk: !!normalizePhone(h.phone) })),
        attendance: attBy.get(fullName(d)) ?? null,
      })),
      lines: lines.map(l => ({ driverCode: l.driverCode, hubCode: l.hubCode, departTime: l.departTime, slots: l.slots ? l.slots.split(',').filter(Boolean) : [], note: l.note, sentAt: l.sentAt, sentStatus: l.sentStatus })),
      prevLines: prev.map(l => ({ driverCode: l.driverCode, hubCode: l.hubCode, departTime: l.departTime, slots: l.slots ? l.slots.split(',').filter(Boolean) : [], note: l.note })),
    })
  } catch (e) { return fail(e) }
}

// PUT /api/ops/planning  { day, lines: [{ driverCode, hubCode, departTime, slots[], note? }] } — remplace le planning du jour
export async function PUT(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const body = await req.json() as { day: string; lines: { driverCode: string; hubCode: string; departTime: string; slots: string[]; note?: string | null }[] }
    if (!DAY_RE.test(body.day) || !Array.isArray(body.lines)) return NextResponse.json({ error: 'day et lines requis' }, { status: 400 })
    const [hubs, drivers, existing] = await Promise.all([prisma.opsHub.findMany({ select: { code: true } }), prisma.opsDriver.findMany({ select: { code: true } }), prisma.opsPlanLine.findMany({ where: { day: body.day } })])
    const hubSet = new Set(hubs.map(h => h.code)), drvSet = new Set(drivers.map(d => d.code)), slotSet = new Set(slotLabels())
    const seen = new Set<string>(), clean: { driverCode: string; hubCode: string; departTime: string; slots: string; note: string | null }[] = []
    for (const l of body.lines) {
      if (!drvSet.has(l.driverCode)) return NextResponse.json({ error: `Livreur inconnu : ${l.driverCode}` }, { status: 400 })
      if (!hubSet.has(l.hubCode)) return NextResponse.json({ error: `Hub inconnu : ${l.hubCode}` }, { status: 400 })
      if (!TIME_RE.test(l.departTime)) return NextResponse.json({ error: `Heure de départ invalide (${l.driverCode}) — format HH:MM` }, { status: 400 })
      if (seen.has(l.driverCode)) continue; seen.add(l.driverCode)
      clean.push({ driverCode: l.driverCode, hubCode: l.hubCode, departTime: l.departTime, slots: (l.slots ?? []).filter(s => slotSet.has(s)).sort().join(','), note: l.note?.trim() || null })
    }
    const by = new Map(existing.map(e => [e.driverCode, e]))
    const removed = existing.filter(e => !seen.has(e.driverCode)).map(e => e.id)
    await prisma.$transaction([
      ...(removed.length ? [prisma.opsPlanLine.deleteMany({ where: { id: { in: removed } } })] : []),
      ...clean.map(l => {
        const o = by.get(l.driverCode); const changed = !o || o.hubCode !== l.hubCode || o.departTime !== l.departTime || o.slots !== l.slots || (o.note ?? null) !== l.note
        return prisma.opsPlanLine.upsert({
          where: { day_driverCode: { day: body.day, driverCode: l.driverCode } },
          create: { day: body.day, ...l, createdBy: auth.session.name || auth.session.email },
          update: { ...l, ...(changed ? { sentAt: null, sentStatus: null } : {}) },
        })
      }),
      prisma.opsPlanDay.upsert({ where: { day: body.day }, create: { day: body.day }, update: {} }),
    ])
    await audit(auth.session, 'planning.save', 'planning', body.day, { lines: clean.length, removed: removed.length })
    return NextResponse.json({ ok: true, saved: clean.length, removed: removed.length })
  } catch (e) { return fail(e) }
}
