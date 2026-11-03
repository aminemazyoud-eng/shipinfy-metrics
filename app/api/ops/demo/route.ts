import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { ACTIVE_SOURCE } from '@/lib/ops-data'
import { CFG } from '@/lib/ops-config'
import { addDays, dayBoundsTz, dayStartUtc, localToday } from '@/lib/tz'
import { bumpOpsEpoch } from '@/lib/ops-cache'
import { limited } from '@/lib/rate-limit'
import { buildDemoPlan, DEMO_PREFIX, DEMO_EVENT_SOURCE, type DemoSlot } from '@/lib/ops-demo'

// Générateur de données de TEST (Paramétrage → Données de démo). ADMIN / SUPER_ADMIN uniquement, et seulement si la source active est « mock ».
// N'émet rien vers l'extérieur : pas de synchro back-office, pas d'outbox, pas de notification client, pas de webhook (événements source « demo » ignorés).
const DISABLED = 'Désactivé : source de données réelle'
const HOUR = 3_600_000
const isDemo = { externalId: { startsWith: DEMO_PREFIX } }

function slotsOfDay(day: string): DemoSlot[] {
  const base = dayStartUtc(day)
  const s = [...CFG.slots].sort((a, b) => a.startHour - b.startHour)
  return s.map((x, i) => ({ label: x.label, startMs: base + x.startHour * HOUR, endMs: base + (s[i + 1]?.startHour ?? x.startHour + 3) * HOUR }))
}

async function counts() {
  const now = Date.now()
  const where = { ...isDemo }
  const pend = { ...where, status: 'DELIVERED', collectedAt: null, amount: { gt: 0 } }
  const [byStatus, collected, pending, pendingSum, over24, over48] = await Promise.all([
    prisma.opsOrder.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.opsOrder.count({ where: { ...where, collectedAt: { not: null } } }),
    prisma.opsOrder.count({ where: pend }),
    prisma.opsOrder.aggregate({ where: pend, _sum: { amount: true } }),
    prisma.opsOrder.count({ where: { ...pend, deliveredAt: { lt: new Date(now - 24 * HOUR) } } }),
    prisma.opsOrder.count({ where: { ...pend, deliveredAt: { lt: new Date(now - 48 * HOUR) } } }),
  ])
  const st = (s: string) => byStatus.find(x => x.status === s)?._count._all ?? 0
  return {
    total: byStatus.reduce((n, x) => n + x._count._all, 0),
    delivered: st('DELIVERED'), collected, pendingCollection: pending, pendingAmount: Math.round(pendingSum._sum.amount ?? 0), over24h: over24, over48h: over48,
    inProgress: st('IN_TRANSPORT') + st('START_DELIVERY'), assigned: st('ASSIGNED'), unassigned: st('READY_PICKUP'), noShow: st('NO_SHOW'), cancelled: st('CANCELLED'),
  }
}

// GET /api/ops/demo → { enabled, reason?, counts, hubs, today }
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  const rl = limited(req, 'ops-demo-get', 60, 60_000)
  if (rl) return rl
  try {
    const hubs = await prisma.opsHub.findMany({ where: { active: true }, orderBy: { code: 'asc' }, select: { code: true, name: true } })
    const base = { hubs, today: localToday() }
    if (ACTIVE_SOURCE !== 'mock') return NextResponse.json({ ...base, enabled: false, reason: DISABLED, counts: await counts() })
    return NextResponse.json({ ...base, enabled: true, counts: await counts() })
  } catch (e) { return fail(e) }
}

// POST /api/ops/demo  { action:'seed', day?, count?, hub? }  |  { action:'reset' }
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  const rl = limited(req, 'ops-demo-post', 10, 60_000)
  if (rl) return rl
  try {
    const b = await req.json().catch(() => ({})) as { action?: string; day?: string; count?: number; hub?: string }
    if (ACTIVE_SOURCE !== 'mock') {
      await audit(auth.session, 'demo.refused', 'config', null, { action: b.action ?? null, source: ACTIVE_SOURCE })
      return NextResponse.json({ error: DISABLED }, { status: 403 })
    }

    if (b.action === 'reset') {
      const ids = (await prisma.opsOrder.findMany({ where: isDemo, select: { id: true } })).map(o => o.id)
      let deleted = 0
      await prisma.$transaction(async tx => {
        for (let i = 0; i < ids.length; i += 1000) {
          const part = ids.slice(i, i + 1000)
          // tables liées par orderId SANS clé étrangère (les événements partent en cascade avec la commande)
          await tx.opsOrderItem.deleteMany({ where: { orderId: { in: part } } })
          await tx.opsProof.deleteMany({ where: { orderId: { in: part } } })
          await tx.opsStop.deleteMany({ where: { orderId: { in: part } } })
          await tx.opsDeliveryRating.deleteMany({ where: { orderId: { in: part } } })
          await tx.opsCustomerNotif.deleteMany({ where: { orderId: { in: part } } })
          await tx.opsDriverAction.deleteMany({ where: { orderId: { in: part } } })
          await tx.opsOrderEvent.deleteMany({ where: { orderId: { in: part } } })
          deleted += (await tx.opsOrder.deleteMany({ where: { id: { in: part }, ...isDemo } })).count
        }
      }, { timeout: 60_000 })
      await audit(auth.session, 'demo.reset', 'order', null, { deleted })
      bumpOpsEpoch()
      return NextResponse.json({ ok: true, deleted, counts: await counts() })
    }

    if (b.action !== 'seed') return NextResponse.json({ error: 'action invalide' }, { status: 400 })
    const today = localToday()
    const day = b.day == null || b.day === '' ? today : String(b.day)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + 'T12:00:00Z'))) return NextResponse.json({ error: 'Jour invalide (AAAA-MM-JJ)' }, { status: 400 })
    if (day > addDays(today, 7) || day < addDays(today, -60)) return NextResponse.json({ error: 'Jour hors de la plage autorisée (−60 / +7 jours)' }, { status: 400 })
    const count = Math.min(300, Math.max(20, Math.round(Number(b.count ?? 120)) || 120))

    const hubRows = await prisma.opsHub.findMany({
      where: { active: true, ...(b.hub ? { code: String(b.hub) } : {}) }, orderBy: { code: 'asc' },
      select: { code: true, city: true, lat: true, lng: true, drivers: { where: { status: 'active' }, select: { id: true, code: true, jobType: true } } },
    })
    if (!hubRows.length) return NextResponse.json({ error: b.hub ? `Hub introuvable : ${b.hub}` : 'Aucun hub actif' }, { status: 409 })
    const hubs = hubRows.map(h => {
      const ch = h.drivers.filter(d => d.jobType === 'chauffeur')
      return { code: h.code, city: h.city, lat: h.lat, lng: h.lng, drivers: (ch.length ? ch : h.drivers).map(d => ({ id: d.id, code: d.code })) }
    })
    const reasons = await prisma.opsReason.findMany({ where: { active: true }, select: { code: true, kind: true } })
    const nonDeliv = reasons.filter(r => r.kind === 'NON_DELIVERY')
    const reasonCodes = (nonDeliv.length ? nonDeliv : reasons).map(r => r.code)

    const nowMs = Date.now()
    const allSlots: DemoSlot[] = []
    for (let k = -5; k <= 1; k++) allSlots.push(...slotsOfDay(addDays(today, k)))
    const daySlots = slotsOfDay(day)
    for (const s of daySlots) if (!allSlots.some(x => x.startMs === s.startMs)) allSlots.push(s)
    const bounds = dayBoundsTz(day)
    const { specs, warnings } = buildDemoPlan({ day, count, nowMs, hubs, daySlots, allSlots, dayStartMs: bounds.from.getTime(), dayEndMs: bounds.to.getTime(), reasonCodes })

    const result = await prisma.$transaction(async tx => {
      const have = new Set((await tx.opsOrder.findMany({ where: { source: ACTIVE_SOURCE, externalId: { in: specs.map(s => s.externalId) } }, select: { externalId: true } })).map(o => o.externalId))
      const fresh = specs.filter(s => !have.has(s.externalId))
      for (let i = 0; i < fresh.length; i += 500) {
        await tx.opsOrder.createMany({
          skipDuplicates: true,
          data: fresh.slice(i, i + 500).map(s => ({
            source: ACTIVE_SOURCE, externalId: s.externalId, reference: s.reference, shipper: 'Démo', hubCode: s.hubCode, city: s.city, district: s.district,
            status: s.status, slotStart: s.slotStart, slotEnd: s.slotEnd, slotLabel: s.slotLabel, amount: s.amount,
            customerName: s.customerName, customerPhone: s.customerPhone, address: s.address, lat: s.lat, lng: s.lng,
            courierRef: s.courierRef, driverId: s.driverId, createdAtSrc: s.createdAtSrc, assignedAt: s.assignedAt, inTransportAt: s.inTransportAt,
            startDeliveryAt: s.startDeliveryAt, deliveredAt: s.deliveredAt, noShowAt: s.noShowAt, arrivedAt: s.arrivedAt,
            deliveredLat: s.deliveredLat, deliveredLng: s.deliveredLng, sourceUpdatedAt: s.sourceUpdatedAt,
            collectedAt: s.collectedAt, collectedAmount: s.collectedAmount, collectedBy: s.collectedBy, collectionMethod: s.collectionMethod,
            reasonCode: s.reasonCode, cancelReason: s.cancelReason,
          })),
        })
      }
      const ids = new Map<string, string>()
      for (let i = 0; i < fresh.length; i += 1000) {
        const rows = await tx.opsOrder.findMany({ where: { source: ACTIVE_SOURCE, externalId: { in: fresh.slice(i, i + 1000).map(s => s.externalId) } }, select: { id: true, externalId: true } })
        for (const r of rows) ids.set(r.externalId, r.id)
      }
      const events = fresh.flatMap(s => { const id = ids.get(s.externalId); return id ? s.events.map(e => ({ orderId: id, fromStatus: e.fromStatus, toStatus: e.toStatus, at: e.at, source: DEMO_EVENT_SOURCE })) : [] })
      for (let i = 0; i < events.length; i += 1000) await tx.opsOrderEvent.createMany({ data: events.slice(i, i + 1000), skipDuplicates: true })
      const items = fresh.flatMap(s => { const id = ids.get(s.externalId); return id ? s.items.map(it => ({ orderId: id, sku: it.sku, label: it.label, qty: it.qty, barcode: it.barcode })) : [] })
      for (let i = 0; i < items.length; i += 1000) await tx.opsOrderItem.createMany({ data: items.slice(i, i + 1000) })
      return { created: fresh.length, skipped: specs.length - fresh.length, events: events.length }
    }, { timeout: 60_000 })

    await audit(auth.session, 'demo.seed', 'order', null, { day, count, hub: b.hub ?? null, ...result })
    bumpOpsEpoch()
    return NextResponse.json({ ok: true, day, ...result, warnings, counts: await counts() })
  } catch (e) { return fail(e) }
}
