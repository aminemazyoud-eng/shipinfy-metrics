/**
 * lib/ops-tours.ts — tournées (OpsTour / OpsStop) : construction, lecture bureau + livreur, report, réordonnancement, ETA, tour de contrôle (Agent C).
 * Le calcul d'ordre est dans lib/ops-route.ts (pur) ; l'ETA par stop dans lib/ops-eta.ts. Tout est SERVEUR (prisma).
 *
 * Contrat avec l'application livreur (agent B) :
 *   getTourForDriver(driverCode, day), postponeStop(driverCode, orderId), recomputeEta(tourId), buildTours(day, hubCode?)
 *   + recomputeEtaForOrder(orderId) : À APPELER après chaque changement de statut d'un stop (voir rapport : processDriverAction).
 * Règles : une tournée DÉMARRÉE (statut ≠ PLANNED ou startedAt posé) n'est jamais reconstruite ; les écritures concurrentes sont
 * sérialisées par un verrou consultatif PostgreSQL (par jour pour la construction, par tournée pour le report).
 */
import { prisma } from '@/lib/prisma'
import { dayBoundsTz, dayStartUtc, addDays, localDay, localToday, attendanceKeyTz } from '@/lib/tz'
import { canonicalSlot } from '@/lib/ops-slots'
import { isLate, isAtRisk, lateMinutes, TERMINAL_STATUSES } from '@/lib/ops-defs'
import {
  loadRouteSettings, planDriverDay, computeArrivals, cheapestInsertion, toPt,
  type Pt, type RouteOrder, type RouteSettings,
} from '@/lib/ops-route'
import { makeTravel, liveLegMinutes, trafficProviderEnabled, legKey, ETA_LABEL_NO_LIVE } from '@/lib/ops-eta'
import { shortName } from '@/lib/ops-driver-actions'
import { customerNotifEnabled, DAILY_CUSTOMER_CAP } from '@/lib/ops-customer-notif'

const TERMINAL = new Set<string>(TERMINAL_STATUSES)
const FINISHED = new Set(['DELIVERED', 'NO_SHOW'])
const ACTIVE_ORDER_STATUSES = ['ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY']
const POSTPONABLE = new Set(['ASSIGNED', 'IN_TRANSPORT'])
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const hubPt = async (code: string | null | undefined): Promise<Pt | null> => {
  if (!code) return null
  const h = await prisma.opsHub.findUnique({ where: { code }, select: { lat: true, lng: true } })
  return toPt(h)
}

// ═══ Construction ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export interface BuildResult {
  day: string; hub: string | null; reoptimize: boolean
  tours: { id: string; driverCode: string; rotation: number; slot: string; stops: number; lateStops: number; overflow: boolean; created: boolean }[]
  created: number; updated: number; removedTours: number; lockedTours: number; skippedStarted: number; unassignedOrders: number
  warnings: string[]
}

/**
 * Construit / complète les tournées d'un jour à partir des commandes AFFECTÉES (driverId). Idempotent :
 *  - par défaut INCRÉMENTAL : les stops existants gardent leur ordre (réordonnancement manuel préservé), les nouvelles commandes sont insérées
 *    au meilleur endroit ou dans une nouvelle rotation, les commandes retirées/terminées sont retirées ; `reoptimize` recalcule tout (NN + 2-opt) ;
 *  - ne touche JAMAIS une tournée démarrée (statut ≠ PLANNED, ou startedAt) ni les commandes qui y figurent.
 */
export async function buildTours(day: string, hubCode?: string | null, opts: { reoptimize?: boolean; nowMs?: number } = {}): Promise<BuildResult> {
  const s = await loadRouteSettings()
  const now = opts.nowMs ?? Date.now()
  const { from, to } = dayBoundsTz(day)
  const res: BuildResult = { day, hub: hubCode ?? null, reoptimize: !!opts.reoptimize, tours: [], created: 0, updated: 0, removedTours: 0, lockedTours: 0, skippedStarted: 0, unassignedOrders: 0, warnings: [] }
  const travel = makeTravel(s)

  const touched = new Set<string>()
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tours:' + day}))`
    const tours = await tx.opsTour.findMany({ where: { day } })
    const stops = tours.length ? await tx.opsStop.findMany({ where: { tourId: { in: tours.map(t => t.id) } }, orderBy: { seq: 'asc' } }) : []
    const isLocked = (t: { status: string; startedAt: Date | null }) => t.status !== 'PLANNED' || t.startedAt != null
    const lockedIds = new Set(tours.filter(isLocked).map(t => t.id))
    res.lockedTours = lockedIds.size
    const lockedOrderIds = new Set(stops.filter(x => lockedIds.has(x.tourId)).map(x => x.orderId))

    const orders = await tx.opsOrder.findMany({
      where: { slotStart: { gte: from, lt: to }, driverId: { not: null }, status: { in: ACTIVE_ORDER_STATUSES }, ...(hubCode ? { hubCode } : {}) },
      select: { id: true, hubCode: true, lat: true, lng: true, slotStart: true, slotEnd: true, sectorCode: true, driverId: true, status: true },
    })
    res.unassignedOrders = await tx.opsOrder.count({ where: { slotStart: { gte: from, lt: to }, driverId: null, status: 'READY_PICKUP', ...(hubCode ? { hubCode } : {}) } })
    const cand = orders.filter(o => !lockedOrderIds.has(o.id))
    res.skippedStarted = orders.length - cand.length

    const drivers = await tx.opsDriver.findMany({
      where: { id: { in: [...new Set(orders.map(o => o.driverId as string))] } },
      include: { hub: { select: { code: true, lat: true, lng: true } }, vehicle: { include: { crew: { select: { code: true, jobType: true } } } } },
    })
    const driverById = new Map(drivers.map(d => [d.id, d]))
    // PLANNED du jour concernés par le filtre de hub
    const plannedAll = tours.filter(t => !isLocked(t))
    const inScope = (t: { hubCode: string | null }) => !hubCode || t.hubCode === hubCode || t.hubCode == null

    const byDriver = new Map<string, typeof cand>()
    for (const o of cand) (byDriver.get(o.driverId as string) ?? byDriver.set(o.driverId as string, []).get(o.driverId as string)!).push(o)
    // les tournées PLANNED de livreurs qui n'ont plus aucune commande candidate sont à vider
    const driverCodesWithTours = new Set(plannedAll.filter(inScope).map(t => t.driverCode))
    const codeOfDriverId = new Map(drivers.map(d => [d.id, d.code]))
    for (const code of driverCodesWithTours) if (![...byDriver.keys()].some(id => codeOfDriverId.get(id) === code)) byDriver.set('code:' + code, [])

    const maxRotation = (code: string) => Math.max(0, ...tours.filter(t => t.driverCode === code).map(t => t.rotation))
    for (const [key, list] of byDriver) {
      const isCodeKey = key.startsWith('code:')
      const drv = isCodeKey ? null : driverById.get(key)
      const code = isCodeKey ? key.slice(5) : (drv as NonNullable<typeof drv>).code
      const start = toPt(drv?.hub) ?? (await hubPt(hubCode)) ?? null
      const myPlanned = plannedAll.filter(t => t.driverCode === code && inScope(t)).sort((a, b) => a.rotation - b.rotation)
      const ro = new Map<string, RouteOrder>(list.map(o => [o.id, { id: o.id, lat: o.lat, lng: o.lng, slot: canonicalSlot(o.slotStart), slotStart: o.slotStart.getTime(), slotEnd: o.slotEnd.getTime(), sector: o.sectorCode }]))
      const stopsOf = (tid: string) => stops.filter(x => x.tourId === tid).sort((a, b) => a.seq - b.seq)

      // Structure voulue : [{ reuseId?, rotation, slot, orderIds[] }]
      type Want = { reuseId?: string; rotation: number; slot: string; orderIds: string[]; late: number; overflow: boolean }
      const want: Want[] = []
      if (opts.reoptimize || !myPlanned.length) {
        const plan = planDriverDay([...ro.values()], start, travel, { serviceMin: s.serviceMin, maxStops: s.maxStops, rotationsPerSlot: s.rotationsPerSlot, loadMin: s.loadMin, earliestMs: day === localToday(now) ? now + 5 * 60_000 : 0 })
        let nextRot = Math.max(maxRotation(code), 0) + 1
        plan.forEach((p, i) => {
          const reuse = myPlanned[i]
          want.push({ reuseId: reuse?.id, rotation: reuse ? reuse.rotation : nextRot++, slot: p.slot, orderIds: p.orderIds, late: p.lateIds.length, overflow: p.overflow })
        })
      } else {
        // incrémental : on garde l'ordre existant, on insère les nouveaux
        const placed = new Set<string>()
        const keep: { tour: (typeof myPlanned)[number]; ids: string[] }[] = myPlanned.map(t => {
          const ids = stopsOf(t.id).map(x => x.orderId).filter(id => ro.has(id))
          ids.forEach(id => placed.add(id))
          return { tour: t, ids }
        })
        const fresh = [...ro.values()].filter(o => !placed.has(o.id))
        const leftovers: RouteOrder[] = []
        for (const o of fresh) {
          const slotOf = (ids: string[]) => ro.get(ids[0])?.slot
          const target = keep.find(k => k.ids.length > 0 && slotOf(k.ids) === o.slot && k.ids.length < s.maxStops)
          const p = toPt(o)
          if (target && p) {
            const path = target.ids.map(id => toPt(ro.get(id) as RouteOrder)).filter((x): x is Pt => !!x)
            const pos = Math.min(target.ids.length, cheapestInsertion(start, path, p))
            target.ids.splice(pos, 0, o.id)
          } else if (target) target.ids.push(o.id)
          else leftovers.push(o)
        }
        keep.forEach(k => { if (k.ids.length) want.push({ reuseId: k.tour.id, rotation: k.tour.rotation, slot: ro.get(k.ids[0])?.slot ?? '', orderIds: k.ids, late: 0, overflow: false }) })
        if (leftovers.length) {
          let nextRot = Math.max(maxRotation(code), ...want.map(w => w.rotation), 0) + 1
          const plan = planDriverDay(leftovers, start, travel, { serviceMin: s.serviceMin, maxStops: s.maxStops, rotationsPerSlot: s.rotationsPerSlot, loadMin: s.loadMin, earliestMs: day === localToday(now) ? now + 5 * 60_000 : 0 })
          for (const p of plan) want.push({ rotation: nextRot++, slot: p.slot, orderIds: p.orderIds, late: p.lateIds.length, overflow: p.overflow })
        }
      }

      // Application
      const reused = new Set(want.map(w => w.reuseId).filter(Boolean) as string[])
      for (const t of myPlanned) {
        if (reused.has(t.id)) continue
        // tournée PLANNED devenue vide / non reconduite : suppression (les commandes gardent leur affectation)
        await tx.opsStop.deleteMany({ where: { tourId: t.id } })
        await tx.opsOrder.updateMany({ where: { tourId: t.id }, data: { tourId: null } })
        await tx.opsTour.delete({ where: { id: t.id } })
        res.removedTours++
      }
      const helper = drv?.vehicle?.crew.find(c => c.jobType === 'helper')?.code ?? null
      for (const w of want) {
        let tourId = w.reuseId
        let createdTour = false
        if (!tourId) {
          const t = await tx.opsTour.create({ data: { day, hubCode: drv?.hub?.code ?? hubCode ?? null, vehicleRef: drv?.vehicle?.plate ?? null, driverCode: code, helperCode: helper, rotation: w.rotation, status: 'PLANNED' } })
          tourId = t.id; createdTour = true; res.created++
        }
        const existing = createdTour ? [] : await tx.opsStop.findMany({ where: { tourId }, orderBy: { seq: 'asc' } }) // relu : un stop a pu changer de tournée plus haut
        const exById = new Map(existing.map(x => [x.orderId, x]))
        // retire les stops qui ne sont plus voulus
        const gone = existing.filter(x => !w.orderIds.includes(x.orderId))
        if (gone.length) { await tx.opsStop.deleteMany({ where: { id: { in: gone.map(g => g.id) } } }); await tx.opsOrder.updateMany({ where: { id: { in: gone.map(g => g.orderId) }, tourId }, data: { tourId: null } }) }
        // positions temporaires négatives évitées : pas de contrainte unique sur (tourId, seq) → mises à jour directes
        let changed = createdTour || gone.length > 0
        for (let i = 0; i < w.orderIds.length; i++) {
          const oid = w.orderIds[i], ex = exById.get(oid)
          if (ex) { if (ex.seq !== i + 1 || ex.serviceMin !== s.serviceMin) { await tx.opsStop.update({ where: { id: ex.id }, data: { seq: i + 1, serviceMin: s.serviceMin } }); changed = true } }
          else {
            const other = await tx.opsStop.findUnique({ where: { orderId: oid } })
            if (other) await tx.opsStop.update({ where: { id: other.id }, data: { tourId, seq: i + 1, serviceMin: s.serviceMin, etaAt: null } })
            else await tx.opsStop.create({ data: { tourId, orderId: oid, seq: i + 1, serviceMin: s.serviceMin } })
            changed = true
          }
        }
        await tx.opsOrder.updateMany({ where: { id: { in: w.orderIds }, OR: [{ tourId: null }, { tourId: { not: tourId } }] }, data: { tourId } })
        if (changed) { touched.add(tourId); if (!createdTour) { res.updated++; await tx.opsTour.update({ where: { id: tourId }, data: { vehicleRef: drv?.vehicle?.plate ?? undefined, helperCode: helper ?? undefined } }) } }
        else touched.add(tourId) // ETA rafraîchies de toute façon
        res.tours.push({ id: tourId, driverCode: code, rotation: w.rotation, slot: w.slot, stops: w.orderIds.length, lateStops: w.late, overflow: w.overflow, created: createdTour })
        if (w.overflow) res.warnings.push(`${code} : rotation ${w.rotation} au-delà des ${s.rotationsPerSlot} rotations par créneau (${w.slot})`)
        if (w.orderIds.length > s.maxStops) res.warnings.push(`${code} : rotation ${w.rotation} dépasse la capacité (${w.orderIds.length}/${s.maxStops})`)
      }
    }
    const noGps = orders.filter(o => !toPt(o)).length
    if (noGps) res.warnings.push(`${noGps} commande(s) sans coordonnées GPS : placées en fin de rotation, trajet estimé par défaut`)
    if (res.unassignedOrders) res.warnings.push(`${res.unassignedOrders} commande(s) non affectées : affectez-les (Dispatch) puis reconstruisez`)
  }, { timeout: 60_000, maxWait: 10_000 })

  for (const id of touched) await recomputeEta(id, { notify: false, nowMs: now }).catch(e => console.warn('[tours] ETA:', e instanceof Error ? e.message : e))
  res.tours.sort((a, b) => a.driverCode.localeCompare(b.driverCode) || a.rotation - b.rotation)
  return res
}

// ═══ ETA ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const lastRefresh = new Map<string, number>()

/**
 * Recalcule l'ETA (OpsStop.etaAt) des stops OUVERTS d'une tournée : point de départ = position GPS récente du livreur, sinon dernier stop clos,
 * sinon hub ; trajet haversine ÷ vitesse (courbe horaire paramétrable, fournisseur de trafic externe en option) + temps de service.
 * Promeut aussi le statut de la tournée (PLANNED → ONGOING au premier stop entamé, → DONE quand tout est clos). Prévient les clients dont
 * l'ETA dérive de plus de X min (kind « eta-… », sans doublon). Toutes les ETA sont « estimées sans trafic live » sauf fournisseur configuré.
 */
export async function recomputeEta(tourId: string, opts: { notify?: boolean; nowMs?: number } = {}): Promise<{ ok: boolean; updated: number; status: string | null; trafficLive: boolean; notified: number }> {
  const now = opts.nowMs ?? Date.now()
  lastRefresh.set(tourId, now)
  const out = { ok: false, updated: 0, status: null as string | null, trafficLive: false, notified: 0 }
  const tour = await prisma.opsTour.findUnique({ where: { id: tourId } })
  if (!tour) return out
  out.status = tour.status
  const s = await loadRouteSettings()
  let stops = await prisma.opsStop.findMany({ where: { tourId }, orderBy: { seq: 'asc' } })
  if (!stops.length) return { ...out, ok: true }
  const drv = await prisma.opsDriver.findUnique({ where: { code: tour.driverCode }, select: { id: true } })
  const orders = await prisma.opsOrder.findMany({
    where: { id: { in: stops.map(x => x.orderId) } },
    select: { id: true, reference: true, externalId: true, status: true, lat: true, lng: true, slotStart: true, slotEnd: true, driverId: true, customerPhone: true, deliveredAt: true, noShowAt: true },
  })
  const ob = new Map(orders.map(o => [o.id, o]))

  // auto-guérison : commande réaffectée à un autre livreur → son stop quitte cette tournée (sauf tournée déjà terminée)
  if (drv && tour.status !== 'DONE') {
    const foreign = stops.filter(x => { const o = ob.get(x.orderId); return !o || (o.driverId != null && o.driverId !== drv.id) })
    if (foreign.length) {
      await prisma.opsStop.deleteMany({ where: { id: { in: foreign.map(f => f.id) } } })
      await prisma.opsOrder.updateMany({ where: { id: { in: foreign.map(f => f.orderId) }, tourId }, data: { tourId: null } })
      stops = stops.filter(x => !foreign.includes(x))
    }
  }
  const open = stops.filter(x => { const o = ob.get(x.orderId); return o && !TERMINAL.has(o.status) })
  const finished = stops.filter(x => { const o = ob.get(x.orderId); return o && FINISHED.has(o.status) })

  // statut de la tournée (CAS)
  const started = stops.some(x => { const o = ob.get(x.orderId); return o && (o.status === 'START_DELIVERY' || FINISHED.has(o.status)) })
  if (stops.length && open.length === 0 && tour.status !== 'DONE') {
    const r = await prisma.$executeRaw`UPDATE "OpsTour" SET "status" = 'DONE', "endedAt" = ${new Date(now)}, "startedAt" = COALESCE("startedAt", ${new Date(now)}), "updatedAt" = ${new Date(now)} WHERE "id" = ${tourId} AND "status" <> 'DONE'`
    if (Number(r)) out.status = 'DONE'
  } else if (started && (tour.status === 'PLANNED' || tour.status === 'LOADING')) {
    const r = await prisma.$executeRaw`UPDATE "OpsTour" SET "status" = 'ONGOING', "startedAt" = COALESCE("startedAt", ${new Date(now)}), "updatedAt" = ${new Date(now)} WHERE "id" = ${tourId} AND "status" IN ('PLANNED','LOADING')`
    if (Number(r)) out.status = 'ONGOING'
  }
  if (!open.length) return { ...out, ok: true }

  // origine et heure de départ
  const hub = await hubPt(tour.hubCode)
  const beganOrStarted = started || out.status === 'ONGOING'
  const lastDone = finished.map(x => ({ x, at: (ob.get(x.orderId)?.deliveredAt ?? ob.get(x.orderId)?.noShowAt)?.getTime() ?? 0 })).sort((a, b) => b.at - a.at)[0]
  let origin: Pt | null = hub, startMs = Math.max(now, Math.min(...open.map(x => (ob.get(x.orderId) as { slotStart: Date }).slotStart.getTime())) - s.loadMin * 60_000)
  if (beganOrStarted) {
    startMs = now
    const pos = await prisma.opsDriverPosition.findFirst({ where: { driverCode: tour.driverCode, at: { gte: new Date(now - 10 * 60_000) } }, orderBy: { at: 'desc' } })
    origin = toPt(pos) ?? toPt(lastDone ? ob.get(lastDone.x.orderId) : null) ?? hub
  }
  const seq = open.map(x => ({ x, o: ob.get(x.orderId) as NonNullable<ReturnType<typeof ob.get>> }))
  const stopsIn = seq.map(({ x, o }) => ({ pt: toPt(o), serviceMin: x.serviceMin ?? s.serviceMin }))

  // 1re passe : modèle horaire ; fournisseur externe (optionnel) : durées réelles par tronçon, puis 2e passe
  let live: Map<string, number> | undefined
  let arrivals = computeArrivals(origin, startMs, stopsIn, makeTravel(s))
  if (trafficProviderEnabled()) {
    live = new Map()
    let prev: Pt | null = origin, t = startMs, legs = 0
    for (let i = 0; i < stopsIn.length; i++) {
      const p = stopsIn[i].pt
      if (prev && p) { legs++; const m = await liveLegMinutes(prev, p, t); if (m != null) live.set(legKey(prev, p), m) }
      t = arrivals[i] + stopsIn[i].serviceMin * 60_000
      if (p) prev = p
    }
    if (live.size) { arrivals = computeArrivals(origin, startMs, stopsIn, makeTravel(s, live)); out.trafficLive = live.size >= legs && legs > 0 }
  }

  const drifts: { o: (typeof seq)[number]['o']; oldEta: Date; newEta: Date }[] = []
  for (let i = 0; i < seq.length; i++) {
    const { x, o } = seq[i], newEta = new Date(arrivals[i])
    if (x.etaAt && Math.abs(x.etaAt.getTime() - newEta.getTime()) < 30_000) continue
    await prisma.opsStop.update({ where: { id: x.id }, data: { etaAt: newEta } })
    out.updated++
    if (x.etaAt) drifts.push({ o, oldEta: x.etaAt, newEta })
  }
  if (opts.notify !== false && customerNotifEnabled()) {
    for (const dr of drifts.slice(0, 20)) { if ((await notifyEtaDrift(dr.o, dr.oldEta, dr.newEta, s.etaDriftNotifyMin)) === 'sent') out.notified++ }
  }
  return { ...out, ok: true }
}

/** Recalcule la tournée qui contient cette commande (à appeler après un changement de statut du stop). Ne lève jamais d'exception. */
export async function recomputeEtaForOrder(orderId: string): Promise<void> {
  try {
    const st = await prisma.opsStop.findUnique({ where: { orderId }, select: { tourId: true } })
    if (st) await recomputeEta(st.tourId)
  } catch (e) { console.warn('[tours] recomputeEtaForOrder:', e instanceof Error ? e.message : e) }
}

/** Recalcule toutes les tournées non terminées d'un jour (appelé après la synchro : les statuts de la source ont pu changer). Jamais bloquant. */
export async function recomputeEtaForDay(day: string = localToday()): Promise<number> {
  try {
    const tours = await prisma.opsTour.findMany({ where: { day, status: { not: 'DONE' } }, select: { id: true }, take: 200 })
    for (const t of tours) await recomputeEta(t.id)
    return tours.length
  } catch (e) { console.warn('[tours] recomputeEtaForDay:', e instanceof Error ? e.message : e); return 0 }
}

/** Rafraîchit paresseusement (≥ 60 s entre deux calculs de la même tournée) : appelé à la lecture par le livreur / le bureau. */
async function refreshIfStale(tourId: string, status: string) {
  if (status === 'DONE') return
  if (Date.now() - (lastRefresh.get(tourId) ?? 0) < 60_000) return
  await recomputeEta(tourId).catch(() => {})
}

async function notifyEtaDrift(o: { id: string; reference: string | null; externalId: string; status: string; customerPhone: string | null; slotEnd: Date }, oldEta: Date, newEta: Date, driftMin: number): Promise<string> {
  try {
    if (TERMINAL.has(o.status)) return 'done'
    if (newEta.getTime() - oldEta.getTime() < driftMin * 60_000) return 'small'
    const { normalizePhone } = await import('@/lib/ops-planning')
    const phone = normalizePhone(o.customerPhone)
    if (!phone) return 'no-phone'
    const prior = await prisma.opsCustomerNotif.findMany({ where: { orderId: o.id, kind: { startsWith: 'eta-' } }, orderBy: { createdAt: 'desc' }, select: { kind: true } })
    if (prior.length >= 4) return 'limit'
    const baseline = prior.length ? Number(prior[0].kind.slice(4)) * 300_000 : oldEta.getTime()
    if (!(newEta.getTime() - baseline >= driftMin * 60_000)) return 'small' // dérive déjà communiquée
    const now = Date.now(), day = localDay(now)
    if ((await prisma.opsCustomerNotif.count({ where: { createdAt: { gte: new Date(dayStartUtc(day)), lt: new Date(dayStartUtc(addDays(day, 1))) } } })) >= DAILY_CUSTOMER_CAP) return 'cap'
    const kind = `eta-${Math.round(newEta.getTime() / 300_000)}`
    try { await prisma.opsCustomerNotif.create({ data: { orderId: o.id, kind, channel: 'whatsapp', status: 'pending' } }) } catch { return 'duplicate' }
    const { sendWhatsApp } = await import('@/lib/whatsapp')
    const { trackUrl } = await import('@/lib/ops-tracking')
    const hhmm = newEta.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' })
    const ok = await sendWhatsApp(phone, `Bonjour, nouvelle estimation pour votre livraison Shipinfy (commande ${o.reference || o.externalId}) : vers ${hhmm}. Suivez-la en direct : ${trackUrl(o.id, o.slotEnd)}`)
    await prisma.opsCustomerNotif.update({ where: { orderId_kind_channel: { orderId: o.id, kind, channel: 'whatsapp' } }, data: { status: ok ? 'sent' : 'failed', error: ok ? null : 'Envoi WhatsApp refusé ou non configuré' } })
    return ok ? 'sent' : 'failed'
  } catch (e) { console.error('[tours] notif ETA:', e instanceof Error ? e.message : 'erreur'); return 'failed' }
}

// ═══ Lecture livreur ════════════════════════════════════════════════════════════════════════════════════════════════════════
export interface DriverStop {
  orderId: string; ref: string; seq: number; etaAt: string | null; customer: string; address: string | null; lat: number | null; lng: number | null
  status: string; postponedCount: number; slotEnd: string; canPostpone: boolean
  items: { id: string; label: string; qty: number; barcode: string | null; loadedQty: number }[]
}
export interface DriverTourView {
  tour: { id: string; status: string; rotation: number; day: string; hubCode: string | null; rotations: number; maxPostpones: number; etaNote: string } | null
  stops: DriverStop[]
}

/** Tournée du jour d'un livreur : la première non terminée, sinon la dernière. Uniquement SES commandes. */
export async function getTourForDriver(driverCode: string, day: string = localToday()): Promise<DriverTourView> {
  const tours = await prisma.opsTour.findMany({ where: { day, driverCode }, orderBy: { rotation: 'asc' } })
  const tour = tours.find(t => t.status !== 'DONE') ?? tours[tours.length - 1]
  if (!tour) return { tour: null, stops: [] }
  await refreshIfStale(tour.id, tour.status)
  const fresh = (await prisma.opsTour.findUnique({ where: { id: tour.id } })) ?? tour
  const s = await loadRouteSettings()
  const drv = await prisma.opsDriver.findUnique({ where: { code: driverCode }, select: { id: true } })
  const stops = await prisma.opsStop.findMany({ where: { tourId: tour.id }, orderBy: { seq: 'asc' } })
  const ids = stops.map(x => x.orderId)
  const [orders, items] = await Promise.all([
    ids.length ? prisma.opsOrder.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true, externalId: true, status: true, customerName: true, address: true, lat: true, lng: true, slotEnd: true, driverId: true } }) : [],
    ids.length ? prisma.opsOrderItem.findMany({ where: { orderId: { in: ids } }, orderBy: { createdAt: 'asc' } }) : [],
  ])
  const ob = new Map(orders.map(o => [o.id, o]))
  const out: DriverStop[] = []
  for (const x of stops) {
    const o = ob.get(x.orderId)
    if (!o || (drv && o.driverId !== drv.id)) continue // jamais la commande d'un autre livreur
    out.push({
      orderId: o.id, ref: o.reference ?? o.externalId, seq: x.seq, etaAt: iso(x.etaAt), customer: shortName(o.customerName), address: o.address, lat: o.lat, lng: o.lng,
      status: o.status, postponedCount: x.postponedCount, slotEnd: o.slotEnd.toISOString(), canPostpone: POSTPONABLE.has(o.status) && x.postponedCount < s.maxPostpones,
      items: items.filter(i => i.orderId === o.id).map(i => ({ id: i.id, label: i.label ?? i.sku ?? 'Article', qty: i.qty, barcode: i.barcode, loadedQty: i.loadedQty })),
    })
  }
  return { tour: { id: fresh.id, status: fresh.status, rotation: fresh.rotation, day: fresh.day, hubCode: fresh.hubCode, rotations: tours.length, maxPostpones: s.maxPostpones, etaNote: ETA_LABEL_NO_LIVE }, stops: out }
}

// ═══ Report ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export type PostponeCode = 'NOT_FOUND' | 'BAD_STATE' | 'MAX_POSTPONES' | 'ALREADY_LAST' | 'CONFLICT'
export interface PostponeResult { ok: boolean; code?: PostponeCode; message?: string; tourId?: string; postponedCount?: number }

/**
 * Reporte un stop en FIN de tournée : seq recalculé, postponedCount++ (CAS), OpsOrder.postponedAt, ETA suivantes recalculées.
 * Refusé si la commande est déjà en livraison, si le plafond de reports est atteint (réglage route.maxPostpones) ou s'il est déjà le dernier.
 */
export async function postponeStop(driverCode: string, orderId: string, opts: { nowMs?: number } = {}): Promise<PostponeResult> {
  const now = new Date(opts.nowMs ?? Date.now())
  const s = await loadRouteSettings()
  const drv = await prisma.opsDriver.findUnique({ where: { code: driverCode }, select: { id: true } })
  const st0 = await prisma.opsStop.findUnique({ where: { orderId }, select: { tourId: true } })
  if (!drv || !st0) return { ok: false, code: 'NOT_FOUND', message: 'Commande absente de votre tournée' }
  const r = await prisma.$transaction(async (tx): Promise<PostponeResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tour:' + st0.tourId}))`
    const stop = await tx.opsStop.findUnique({ where: { orderId } })
    const tour = stop ? await tx.opsTour.findUnique({ where: { id: stop.tourId } }) : null
    const order = await tx.opsOrder.findFirst({ where: { id: orderId, driverId: drv.id }, select: { status: true } })
    if (!stop || !tour || tour.driverCode !== driverCode || !order) return { ok: false, code: 'NOT_FOUND', message: 'Commande absente de votre tournée' }
    if (!POSTPONABLE.has(order.status)) return { ok: false, code: 'BAD_STATE', message: 'Cette livraison est déjà en cours ou terminée : report impossible', tourId: tour.id }
    if (stop.postponedCount >= s.maxPostpones) return { ok: false, code: 'MAX_POSTPONES', message: `Report impossible : ${s.maxPostpones} report(s) maximum par commande`, tourId: tour.id, postponedCount: stop.postponedCount }
    const all = await tx.opsStop.findMany({ where: { tourId: tour.id }, orderBy: { seq: 'asc' } })
    const orderStatus = new Map((await tx.opsOrder.findMany({ where: { id: { in: all.map(a => a.orderId) } }, select: { id: true, status: true } })).map(o => [o.id, o.status]))
    const lastOpen = [...all].reverse().find(a => !TERMINAL.has(orderStatus.get(a.orderId) ?? ''))
    if (lastOpen && lastOpen.orderId === orderId) return { ok: false, code: 'ALREADY_LAST', message: 'Cette commande est déjà la dernière de la tournée', tourId: tour.id, postponedCount: stop.postponedCount }
    // CAS sur le compteur : deux reports simultanés ne passent pas ensemble
    const cas = await tx.opsStop.updateMany({ where: { id: stop.id, postponedCount: stop.postponedCount }, data: { postponedCount: { increment: 1 } } })
    if (!cas.count) return { ok: false, code: 'CONFLICT', message: 'Tournée modifiée en même temps, réessayez', tourId: tour.id }
    const next = [...all.filter(a => a.id !== stop.id), stop]
    for (let i = 0; i < next.length; i++) if (next[i].seq !== i + 1) await tx.opsStop.update({ where: { id: next[i].id }, data: { seq: i + 1 } })
    await tx.opsOrder.update({ where: { id: orderId }, data: { postponedAt: now } })
    return { ok: true, tourId: tour.id, postponedCount: stop.postponedCount + 1 }
  }, { timeout: 15_000 })
  if (r.ok && r.tourId) {
    const { bumpOpsEpoch } = await import('@/lib/ops-cache'); bumpOpsEpoch()
    await recomputeEta(r.tourId, { notify: true, nowMs: now.getTime() }).catch(e => console.warn('[tours] ETA après report:', e instanceof Error ? e.message : e))
  }
  return r
}

// ═══ Bureau : lecture + réordonnancement ═══════════════════════════════════════════════════════════════════════════════════
export interface OfficeStop {
  orderId: string; ref: string; seq: number; status: string; etaAt: string | null; slotLabel: string | null; slotEnd: string; sector: string | null; district: string | null
  customer: string | null; address: string | null; lat: number | null; lng: number | null; postponedCount: number; postponedAt: string | null; late: boolean; lateMin: number; etaLateMin: number
}
export interface OfficeTour {
  id: string; day: string; hubCode: string | null; driverCode: string; driverName: string; vehicleRef: string | null; helperCode: string | null
  rotation: number; status: string; startedAt: string | null; endedAt: string | null; total: number; done: number; remaining: number; progressPct: number
  nextEtaAt: string | null; lastEtaAt: string | null; lateStops: number; etaLateStops: number; stops: OfficeStop[]
}

export async function getToursForDay(day: string, hubCode?: string | null): Promise<{ day: string; hub: string | null; etaNote: string; trafficLive: boolean; tours: OfficeTour[]; unplanned: number; unassigned: number }> {
  const now = Date.now()
  const tours = await prisma.opsTour.findMany({ where: { day, ...(hubCode ? { hubCode } : {}) }, orderBy: [{ driverCode: 'asc' }, { rotation: 'asc' }] })
  for (const t of tours) await refreshIfStale(t.id, t.status)
  const fresh = tours.length ? await prisma.opsTour.findMany({ where: { id: { in: tours.map(t => t.id) } }, orderBy: [{ driverCode: 'asc' }, { rotation: 'asc' }] }) : []
  const stops = fresh.length ? await prisma.opsStop.findMany({ where: { tourId: { in: fresh.map(t => t.id) } }, orderBy: { seq: 'asc' } }) : []
  const [orders, drivers] = await Promise.all([
    stops.length ? prisma.opsOrder.findMany({ where: { id: { in: stops.map(x => x.orderId) } }, select: { id: true, reference: true, externalId: true, status: true, slotLabel: true, slotEnd: true, sectorCode: true, district: true, customerName: true, address: true, lat: true, lng: true, postponedAt: true } }) : [],
    prisma.opsDriver.findMany({ where: { code: { in: [...new Set(fresh.map(t => t.driverCode))] } }, select: { code: true, firstName: true, lastName: true } }),
  ])
  const ob = new Map(orders.map(o => [o.id, o]))
  const nm = new Map(drivers.map(d => [d.code, `${d.firstName} ${d.lastName}`.trim()]))
  const { from, to } = dayBoundsTz(day)
  const [unplanned, unassigned] = await Promise.all([
    prisma.opsOrder.count({ where: { slotStart: { gte: from, lt: to }, driverId: { not: null }, status: { in: ACTIVE_ORDER_STATUSES }, tourId: null, ...(hubCode ? { hubCode } : {}) } }),
    prisma.opsOrder.count({ where: { slotStart: { gte: from, lt: to }, driverId: null, status: 'READY_PICKUP', ...(hubCode ? { hubCode } : {}) } }),
  ])
  const out: OfficeTour[] = fresh.map(t => {
    const ss: OfficeStop[] = stops.filter(x => x.tourId === t.id).flatMap(x => {
      const o = ob.get(x.orderId)
      if (!o) return []
      const isOpen = !TERMINAL.has(o.status)
      return [{
        orderId: o.id, ref: o.reference ?? o.externalId, seq: x.seq, status: o.status, etaAt: iso(x.etaAt), slotLabel: o.slotLabel, slotEnd: o.slotEnd.toISOString(), sector: o.sectorCode, district: o.district,
        customer: o.customerName, address: o.address, lat: o.lat, lng: o.lng, postponedCount: x.postponedCount, postponedAt: iso(o.postponedAt),
        late: isLate({ status: o.status, slotEnd: o.slotEnd }, now), lateMin: lateMinutes({ status: o.status, slotEnd: o.slotEnd }, now),
        etaLateMin: isOpen && x.etaAt ? Math.max(0, Math.round((x.etaAt.getTime() - o.slotEnd.getTime()) / 60_000)) : 0,
      }]
    })
    const done = ss.filter(x => TERMINAL.has(x.status)).length
    const open = ss.filter(x => !TERMINAL.has(x.status) && x.etaAt)
    return {
      id: t.id, day: t.day, hubCode: t.hubCode, driverCode: t.driverCode, driverName: nm.get(t.driverCode) ?? t.driverCode, vehicleRef: t.vehicleRef, helperCode: t.helperCode,
      rotation: t.rotation, status: t.status, startedAt: iso(t.startedAt), endedAt: iso(t.endedAt), total: ss.length, done, remaining: ss.length - done,
      progressPct: ss.length ? Math.round((done / ss.length) * 100) : 0, nextEtaAt: open[0]?.etaAt ?? null, lastEtaAt: open[open.length - 1]?.etaAt ?? null,
      lateStops: ss.filter(x => x.late).length, etaLateStops: ss.filter(x => !x.late && x.etaLateMin > 0).length, stops: ss,
    }
  })
  return { day, hub: hubCode ?? null, etaNote: ETA_LABEL_NO_LIVE, trafficLive: trafficProviderEnabled(), tours: out, unplanned, unassigned }
}

/**
 * Réordonnancement manuel (bureau) : `orderIds` = ordre souhaité des stops OUVERTS (tous, sans oubli ni doublon). Les stops clos gardent leur place.
 * Renvoie un code d'erreur sinon. ETA recalculées ensuite.
 */
export async function reorderTour(tourId: string, orderIds: string[]): Promise<{ ok: boolean; code?: string; message?: string }> {
  const r = await prisma.$transaction(async (tx): Promise<{ ok: boolean; code?: string; message?: string }> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tour:' + tourId}))`
    const tour = await tx.opsTour.findUnique({ where: { id: tourId } })
    if (!tour) return { ok: false, code: 'NOT_FOUND', message: 'Tournée introuvable' }
    if (tour.status === 'DONE') return { ok: false, code: 'BAD_STATE', message: 'Tournée terminée' }
    const all = await tx.opsStop.findMany({ where: { tourId }, orderBy: { seq: 'asc' } })
    const st = new Map((await tx.opsOrder.findMany({ where: { id: { in: all.map(a => a.orderId) } }, select: { id: true, status: true } })).map(o => [o.id, o.status]))
    const closed = all.filter(a => TERMINAL.has(st.get(a.orderId) ?? ''))
    const open = all.filter(a => !TERMINAL.has(st.get(a.orderId) ?? ''))
    const want = new Set(orderIds)
    if (want.size !== orderIds.length || orderIds.length !== open.length || !open.every(a => want.has(a.orderId))) return { ok: false, code: 'MISMATCH', message: 'La liste doit contenir exactement les stops ouverts de la tournée, sans doublon' }
    const byOrder = new Map(open.map(a => [a.orderId, a]))
    const next = [...closed, ...orderIds.map(id => byOrder.get(id) as (typeof open)[number])]
    for (let i = 0; i < next.length; i++) if (next[i].seq !== i + 1) await tx.opsStop.update({ where: { id: next[i].id }, data: { seq: i + 1 } })
    return { ok: true }
  }, { timeout: 15_000 })
  if (r.ok) { const { bumpOpsEpoch } = await import('@/lib/ops-cache'); bumpOpsEpoch(); await recomputeEta(tourId, { notify: true }).catch(() => {}) }
  return r
}

// ═══ Tour de contrôle ═══════════════════════════════════════════════════════════════════════════════════════════════════════
export interface FleetAlert { id: string; kind: 'slot_late' | 'delivery_risk' | 'no_signal' | 'geo_outside'; severity: 'critical' | 'warning' | 'info'; driverCode: string | null; orderId: string | null; ref: string | null; message: string }

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' })

/** Photo temps réel : dernière position de chaque livreur (fenêtre `positionMin`), avancement des tournées, alertes calculées. */
export async function fleetLive(day: string, opts: { hub?: string | null; positionMin?: number } = {}) {
  const now = Date.now(), positionMin = opts.positionMin ?? 15
  const office = await getToursForDay(day, opts.hub)
  const since = new Date(now - positionMin * 60_000)
  const pos = await prisma.$queryRaw<{ driverCode: string; tourId: string | null; lat: number; lng: number; speed: number | null; accuracy: number | null; at: Date }[]>`
    SELECT DISTINCT ON ("driverCode") "driverCode","tourId","lat","lng","speed","accuracy","at" FROM "OpsDriverPosition" WHERE "at" >= ${since} ORDER BY "driverCode", "at" DESC`
  const posBy = new Map(pos.map(p => [p.driverCode, p]))
  const alerts: FleetAlert[] = []
  const vehicles: unknown[] = []
  const seenDrivers = new Set<string>()
  for (const t of office.tours) {
    const p = posBy.get(t.driverCode)
    const active = t.status === 'ONGOING' || (t.status !== 'DONE' && t.done > 0)
    const next = t.stops.find(x => !TERMINAL.has(x.status))
    if (p && !seenDrivers.has(t.driverCode) && t.status !== 'DONE') {
      seenDrivers.add(t.driverCode)
      vehicles.push({ driverCode: t.driverCode, name: t.driverName, hubCode: t.hubCode, vehicleRef: t.vehicleRef, lat: p.lat, lng: p.lng, speedKmh: p.speed != null ? Math.round(p.speed * 3.6) : null, accuracyM: p.accuracy, at: p.at.toISOString(), ageSec: Math.round((now - p.at.getTime()) / 1000), tourId: t.id, rotation: t.rotation, tourStatus: t.status, done: t.done, total: t.total, remaining: t.remaining, nextStop: next ? { ref: next.ref, etaAt: next.etaAt, status: next.status } : null, lateStops: t.lateStops, etaLateStops: t.etaLateStops })
    }
    if (active && !p) alerts.push({ id: `nosig:${t.id}`, kind: 'no_signal', severity: 'warning', driverCode: t.driverCode, orderId: null, ref: null, message: `${t.driverName} : aucune position GPS depuis plus de ${positionMin} min (tournée ${t.rotation} en cours)` })
    for (const x of t.stops) {
      if (TERMINAL.has(x.status)) continue
      if (x.late) alerts.push({ id: `late:${x.orderId}`, kind: 'slot_late', severity: x.lateMin >= 30 ? 'critical' : 'warning', driverCode: t.driverCode, orderId: x.orderId, ref: x.ref, message: `Commande ${x.ref} en retard de ${x.lateMin} min (créneau ${x.slotLabel ?? ''}) — ${t.driverName}` })
      else if (x.etaLateMin > 0) alerts.push({ id: `risk:${x.orderId}`, kind: 'delivery_risk', severity: x.etaLateMin >= 20 ? 'critical' : 'warning', driverCode: t.driverCode, orderId: x.orderId, ref: x.ref, message: `Risque de non-livraison dans le créneau : ${x.ref}, ETA ${hhmm(Date.parse(x.etaAt as string))} pour une fin à ${hhmm(Date.parse(x.slotEnd))} — ${t.driverName}` })
      else if (isAtRisk({ status: x.status, slotEnd: x.slotEnd }, now) && !x.etaAt) alerts.push({ id: `risk:${x.orderId}`, kind: 'delivery_risk', severity: 'info', driverCode: t.driverCode, orderId: x.orderId, ref: x.ref, message: `${x.ref} : fin de créneau proche, pas encore de livraison en cours — ${t.driverName}` })
    }
  }
  // présence : pointage d'arrivée ou livraison hors du rayon (contrôle « souple » : le geste n'est pas bloqué, il est signalé)
  try {
    const [att, drivers, outside] = await Promise.all([
      prisma.driverAttendance.findMany({ where: { date: attendanceKeyTz(day), checkInGeoOk: false }, select: { driverName: true, checkInDistanceM: true } }),
      prisma.opsDriver.findMany({ select: { code: true, firstName: true, lastName: true } }),
      (async () => { const { from, to } = dayBoundsTz(day); return prisma.opsOrder.findMany({ where: { deliveryGeoOk: false, OR: [{ deliveredAt: { gte: from, lt: to } }, { noShowAt: { gte: from, lt: to } }], ...(opts.hub ? { hubCode: opts.hub } : {}) }, select: { id: true, reference: true, externalId: true, deliveryDistanceM: true, courierRef: true }, take: 100 }) })(),
    ])
    const codeByName = new Map(drivers.map(d => [`${d.firstName} ${d.lastName}`, d.code]))
    for (const a of att) alerts.push({ id: `chk:${a.driverName}`, kind: 'geo_outside', severity: 'warning', driverCode: codeByName.get(a.driverName) ?? null, orderId: null, ref: null, message: `Pointage d'arrivée hors rayon : ${a.driverName}${a.checkInDistanceM != null ? ` (${a.checkInDistanceM} m du hub)` : ''}` })
    for (const o of outside) alerts.push({ id: `geo:${o.id}`, kind: 'geo_outside', severity: 'warning', driverCode: o.courierRef, orderId: o.id, ref: o.reference ?? o.externalId, message: `Arrivée/livraison hors rayon : ${o.reference ?? o.externalId}${o.deliveryDistanceM != null ? ` (${o.deliveryDistanceM} m de l'adresse)` : ''}` })
  } catch (e) { console.warn('[fleet-live] présence:', e instanceof Error ? e.message : e) }
  const rank = { critical: 0, warning: 1, info: 2 } as const
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity])
  const totals = {
    tours: office.tours.length, ongoing: office.tours.filter(t => t.status === 'ONGOING').length, done: office.tours.filter(t => t.status === 'DONE').length,
    stops: office.tours.reduce((n, t) => n + t.total, 0), stopsDone: office.tours.reduce((n, t) => n + t.done, 0),
    late: office.tours.reduce((n, t) => n + t.lateStops, 0), atRiskEta: office.tours.reduce((n, t) => n + t.etaLateStops, 0), online: vehicles.length,
  }
  return { day, serverTime: new Date(now).toISOString(), positionWindowMin: positionMin, etaNote: ETA_LABEL_NO_LIVE, trafficLive: trafficProviderEnabled(), vehicles, tours: office.tours, alerts: alerts.slice(0, 100), alertsTotal: alerts.length, totals, unplanned: office.unplanned, unassigned: office.unassigned }
}
export type { RouteSettings }
