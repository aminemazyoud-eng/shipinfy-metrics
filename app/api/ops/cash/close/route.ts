import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { CFG } from '@/lib/ops-config'
import { dayOfTz, dayBoundsTz, addDays, localToday } from '@/lib/tz'
import { xlsxResponse } from '@/lib/xlsx-response'
import { bumpOpsEpoch } from '@/lib/ops-cache'

const DAY_RE = /^\d{4}-\d\d-\d\d$/
const round2 = (n: number) => Math.round(n * 100) / 100

const closeSel = { id: true, day: true, hubCode: true, driverCode: true, expected: true, declared: true, gap: true, note: true, closedBy: true, closedAt: true } as const

/** Attendu par livreur : somme des commandes DELIVERED du jour local (montant encaissé si encaissée, sinon montant de la commande). */
async function expectedByDriver(day: string, hub: string) {
  const { from, to } = dayBoundsTz(day)
  const rows = await prisma.opsOrder.findMany({
    where: { status: 'DELIVERED', hubCode: hub, deliveredAt: { gte: from, lt: to } }, take: 20_000,
    select: { amount: true, collectedAt: true, collectedAmount: true, driver: { select: { code: true, firstName: true, lastName: true } } },
  })
  const by = new Map<string, { code: string; name: string; expected: number; count: number }>()
  for (const o of rows) {
    const code = o.driver?.code ?? '—', name = o.driver ? `${o.driver.firstName} ${o.driver.lastName}` : 'Non affecté'
    const g = by.get(code) ?? { code, name, expected: 0, count: 0 }
    g.expected += (o.collectedAt ? o.collectedAmount : o.amount) ?? 0; g.count++; by.set(code, g)
  }
  const drivers = [...by.values()].map(g => ({ ...g, expected: round2(g.expected) })).sort((a, b) => a.name.localeCompare(b.name))
  return { drivers, total: round2(drivers.reduce((s, d) => s + d.expected, 0)), count: rows.length }
}

// GET /api/ops/cash/close?day=&hub= — attendu par livreur + clôtures du jour + historique des 14 derniers jours
//     &format=xlsx → export Excel de l'historique (14 jours, ou &days=N jusqu'à 90)
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const day = dayOfTz(sp.get('day')), hub = sp.get('hub') || ''
    if (!DAY_RE.test(day)) return NextResponse.json({ error: 'Date invalide' }, { status: 400 })
    const days = Math.min(90, Math.max(1, Number(sp.get('days')) || 14))
    const since = addDays(localToday(), -(days - 1))

    if (sp.get('format') === 'xlsx') {
      const hist = await prisma.opsCashClose.findMany({ where: { day: { gte: since }, ...(hub ? { hubCode: hub } : {}) }, orderBy: [{ day: 'desc' }, { closedAt: 'desc' }], take: 5000, select: closeSel })
      const n = (v: number) => String(round2(Number(v))).replace('.', ',')
      const head = ['Jour', 'Hub', 'Livreur', 'Attendu (MAD)', 'Remis (MAD)', 'Écart (MAD)', 'Note', 'Clôturé par', 'Clôturé le']
      const lines = [head, ...hist.map(r => [r.day, r.hubCode, r.driverCode || 'Total hub', n(r.expected), n(r.declared), n(r.gap), r.note ?? '', r.closedBy ?? '', new Date(r.closedAt).toISOString().replace('T', ' ').slice(0, 16)])]
      return xlsxResponse(lines.map(l => l.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n'), `clotures_caisse_${since}_${localToday()}`, 'Clôtures')
    }

    if (!hub) return NextResponse.json({ error: 'hub requis' }, { status: 400 })
    const [exp, closes, history] = await Promise.all([
      expectedByDriver(day, hub),
      prisma.opsCashClose.findMany({ where: { day, hubCode: hub }, select: closeSel }),
      prisma.opsCashClose.findMany({ where: { day: { gte: since }, hubCode: hub }, orderBy: [{ day: 'desc' }, { closedAt: 'desc' }], take: 500, select: closeSel }),
    ])
    const closeOf = new Map(closes.map(c => [c.driverCode, c]))
    const view = (c: (typeof closes)[number] | undefined) => (c ? { declared: Number(c.declared), gap: Number(c.gap), note: c.note, closedBy: c.closedBy, closedAt: c.closedAt } : null)
    return NextResponse.json({
      day, hubCode: hub, gapAlert: CFG.cashGapAlert,
      drivers: exp.drivers.map(d => ({ ...d, closed: view(closeOf.get(d.code)) })),
      hub: { expected: exp.total, count: exp.count, closed: view(closeOf.get('')) },
      history: history.map(h => ({ id: h.id, day: h.day, driverCode: h.driverCode, expected: Number(h.expected), declared: Number(h.declared), gap: Number(h.gap), note: h.note, closedBy: h.closedBy, closedAt: h.closedAt })),
    })
  } catch (e) { return fail(e) }
}

// POST /api/ops/cash/close (DISPATCHER) { day, hubCode, driverCode?, declared, note? } — clôture unique par jour × hub × livreur (409 si déjà clôturé)
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as { day?: string; hubCode?: string; driverCode?: string; declared?: number; note?: string }
    const day = String(b.day ?? ''), hubCode = String(b.hubCode ?? '').trim(), driverCode = String(b.driverCode ?? '').trim()
    const declared = Number(b.declared)
    if (!DAY_RE.test(day) || Number.isNaN(Date.parse(day + 'T12:00:00Z'))) return NextResponse.json({ error: 'Date invalide (AAAA-MM-JJ)' }, { status: 400 })
    if (day > localToday()) return NextResponse.json({ error: 'Impossible de clôturer un jour futur' }, { status: 400 })
    if (!hubCode || hubCode.length > 40 || driverCode.length > 40) return NextResponse.json({ error: 'hubCode requis' }, { status: 400 })
    if (!Number.isFinite(declared) || declared < 0 || declared > 10_000_000) return NextResponse.json({ error: 'Montant remis invalide' }, { status: 400 })
    const note = b.note ? String(b.note).slice(0, 500) : null

    const exp = await expectedByDriver(day, hubCode)
    const expected = driverCode ? (exp.drivers.find(d => d.code === driverCode)?.expected ?? 0) : exp.total
    const gap = round2(declared - expected)
    const who = auth.session.name || auth.session.email
    let id: string
    try {
      id = (await prisma.opsCashClose.create({ data: { day, hubCode, driverCode, expected, declared: round2(declared), gap, note, closedBy: who }, select: { id: true } })).id
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return NextResponse.json({ error: 'Déjà clôturé pour ce jour, ce hub et ce livreur' }, { status: 409 })
      throw e
    }

    const alert = Math.abs(gap) > CFG.cashGapAlert
    await audit(auth.session, alert ? 'cash.gap' : 'cash.close', 'cash', id, { day, driverCode: driverCode || null, expected, declared: round2(declared), gap, threshold: CFG.cashGapAlert }, hubCode)
    bumpOpsEpoch()
    return NextResponse.json({ ok: true, id, expected, declared: round2(declared), gap, alert })
  } catch (e) { return fail(e) }
}
