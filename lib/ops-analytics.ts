/**
 * lib/ops-analytics.ts — Prévisions par hub × créneau + agrégats live (Module 1)
 * Fonctions PURES (aucun import) : testables sans base, partagées par les routes API.
 *
 * Méthode de prévision d'un créneau (hub × fenêtre horaire) pour un jour J :
 *   known     = commandes déjà reçues pour ce créneau
 *   hist      = volume final moyen observé sur les jours passés (même jour de semaine si ≥3 occurrences)
 *   p         = part du volume final habituellement connue à ce moment (courbe d'arrivée des commandes)
 *   expected  = max(known, w·known/p + (1-w)·hist)  avec w = min(0.8, p)  — plus on s'approche, plus on croit le « déjà reçu »
 * Capacité = livreurs du hub × commandes/livreur/créneau. Niveau : ok < 70 % ≤ tendu < 100 % ≤ saturé.
 */

export interface OrderLite {
  id: string
  hubCode: string
  city: string | null
  status: string
  slotStart: string
  slotEnd: string
  slotLabel: string | null
  createdAt: string | null
  deliveredAt: string | null
  noShowAt: string | null
  lat: number | null
  lng: number | null
  driverCode: string | null
  amount: number | null
  district: string | null
}
export interface HubLite { code: string; name: string; city: string; lat: number | null; lng: number | null }
export interface DriverLite { code: string; firstName: string; lastName: string; hubCode: string | null; vehicleType?: string | null }

const TZ_MS = 60 * 60 * 1000 // Africa/Casablanca UTC+1
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 24 * HOUR
export const DONE = new Set(['DELIVERED', 'NO_SHOW'])
export const STATUS_ORDER = ['READY_PICKUP', 'ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY', 'DELIVERED', 'NO_SHOW'] as const

const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
export const localDay = (ms: number) => new Date(ms + TZ_MS).toISOString().slice(0, 10)
const localDayIdx = (ms: number) => Math.floor((ms + TZ_MS) / DAY)
const weekday = (ms: number) => new Date(ms + TZ_MS).getUTCDay()
const hh = (ms: number) => String(new Date(ms + TZ_MS).getUTCHours()).padStart(2, '0')
export const slotLabelOf = (o: { slotStart: string; slotEnd: string; slotLabel: string | null }) =>
  o.slotLabel || `${hh(t(o.slotStart))}-${hh(t(o.slotEnd))}`

export function resolveDay(spec: string | null | undefined, nowMs: number): string {
  const base = localDayIdx(nowMs)
  const idx = !spec || spec === 'today' ? base : spec === 'tomorrow' ? base + 1 : spec === 'yesterday' ? base - 1
    : /^\d{4}-\d\d-\d\d$/.test(spec) ? Math.floor(Date.parse(spec + 'T00:00:00Z') / DAY) : base + (Number(spec) || 0)
  return new Date(idx * DAY).toISOString().slice(0, 10)
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

export type Level = 'ok' | 'tendu' | 'sature' | 'vide'
const levelOf = (load: number, expected: number): Level => (expected === 0 ? 'vide' : load >= 1 ? 'sature' : load >= 0.7 ? 'tendu' : 'ok')

export interface ForecastCell { known: number; expected: number; capacity: number; load: number; level: Level; neededDrivers: number }
export interface ForecastHub {
  code: string; name: string; city: string; drivers: number
  cells: Record<string, ForecastCell>
  totalKnown: number; totalExpected: number; peakLoad: number; gap: number
}
export interface ForecastResult {
  day: string; generatedAt: string; perDriverPerSlot: number; historyDays: number
  slots: string[]; hubs: ForecastHub[]
  totals: Record<string, { known: number; expected: number; capacity: number }>
  summary: { known: number; expected: number; saturatedCells: number; tenseCells: number; driversGap: number; drivers: number }
}

export function forecastDay(
  orders: OrderLite[], hubs: HubLite[], drivers: DriverLite[], day: string, nowMs: number,
  opts: { perDriverPerSlot?: number; city?: string | null } = {},
): ForecastResult {
  const perDriver = opts.perDriverPerSlot ?? 3
  const hubList = hubs.filter(h => !opts.city || h.city === opts.city.toUpperCase())
  const hubCodes = new Set(hubList.map(h => h.code))
  const dayStart = Date.parse(day + 'T00:00:00Z') - TZ_MS
  const dayEnd = dayStart + DAY

  const target = orders.filter(o => hubCodes.has(o.hubCode) && t(o.slotStart) >= dayStart && t(o.slotStart) < dayEnd)
  const hist = orders.filter(o => hubCodes.has(o.hubCode) && t(o.slotStart) < dayStart && t(o.slotStart) >= dayStart - 42 * DAY)

  // jours d'historique « complets » (≥ 20 commandes ce jour-là, tous hubs) — exclut les bords d'export
  const perDay = new Map<string, number>()
  for (const o of hist) { const d = localDay(t(o.slotStart)); perDay.set(d, (perDay.get(d) || 0) + 1) }
  const histDays = [...perDay.entries()].filter(([, n]) => n >= 20).map(([d]) => d).sort()
  const histSet = new Set(histDays)
  const sameWd = histDays.filter(d => new Date(d + 'T00:00:00Z').getUTCDay() === new Date(day + 'T00:00:00Z').getUTCDay())
  const useDays = sameWd.length >= 3 ? sameWd : histDays
  const useSet = new Set(useDays)

  // volume final par (hub, créneau, jour)
  const finalBy = new Map<string, number>()
  for (const o of hist) {
    const d = localDay(t(o.slotStart)); if (!useSet.has(d)) continue
    const k = `${o.hubCode}|${slotLabelOf(o)}|${d}`; finalBy.set(k, (finalBy.get(k) || 0) + 1)
  }
  const histAvg = (hub: string, slot: string) => (useDays.length ? mean(useDays.map(d => finalBy.get(`${hub}|${slot}|${d}`) || 0)) : 0)

  // courbe d'arrivée : part des commandes déjà connues `lead` avant le début du créneau (par créneau, repli global)
  const histAll = hist.filter(o => histSet.has(localDay(t(o.slotStart))) && o.createdAt)
  const knownShare = (slot: string | null, leadMs: number): number => {
    const pool = slot ? histAll.filter(o => slotLabelOf(o) === slot) : histAll
    const src = pool.length >= 30 ? pool : histAll
    if (!src.length) return 1
    return src.filter(o => t(o.createdAt) <= t(o.slotStart) - leadMs).length / src.length
  }

  const slotSet = new Set<string>()
  for (const o of target) slotSet.add(slotLabelOf(o))
  for (const h of hubList) for (const d of useDays) for (const [k, n] of finalBy) if (n && k.startsWith(h.code + '|') && k.endsWith('|' + d)) slotSet.add(k.split('|')[1])
  const slots = [...slotSet].sort((a, b) => Number(a.slice(0, 2)) - Number(b.slice(0, 2)) || a.localeCompare(b))
  const slotStartMs = (label: string) => dayStart + Number(label.slice(0, 2)) * HOUR

  const driversByHub = new Map<string, number>()
  for (const d of drivers) if (d.hubCode) driversByHub.set(d.hubCode, (driversByHub.get(d.hubCode) || 0) + 1)

  const out: ForecastHub[] = []
  const totals: ForecastResult['totals'] = {}
  for (const s of slots) totals[s] = { known: 0, expected: 0, capacity: 0 }
  let saturated = 0, tense = 0, gapTotal = 0

  for (const h of hubList) {
    const nDrivers = driversByHub.get(h.code) || 0
    const cells: Record<string, ForecastCell> = {}
    let tk = 0, te = 0, peak = 0, maxNeeded = 0
    for (const s of slots) {
      const known = target.filter(o => o.hubCode === h.code && slotLabelOf(o) === s && (!o.createdAt || t(o.createdAt) <= nowMs)).length
      const lead = slotStartMs(s) - nowMs
      let expected: number
      if (lead <= 0) expected = known // créneau commencé : volume figé
      else {
        const p = Math.max(knownShare(s, lead), 0.02)
        const a = histAvg(h.code, s)
        const w = Math.min(0.8, p)
        expected = Math.max(known, Math.round(known > 0 ? w * (known / p) + (1 - w) * a : a))
      }
      const capacity = nDrivers * perDriver
      const load = capacity > 0 ? expected / capacity : expected > 0 ? 9.99 : 0
      const level = levelOf(load, expected)
      const needed = Math.ceil(expected / perDriver)
      cells[s] = { known, expected, capacity, load: Math.round(load * 100) / 100, level, neededDrivers: needed }
      tk += known; te += expected; peak = Math.max(peak, load); maxNeeded = Math.max(maxNeeded, needed)
      totals[s].known += known; totals[s].expected += expected; totals[s].capacity += capacity
      if (level === 'sature') saturated++; else if (level === 'tendu') tense++
    }
    const gap = Math.max(0, maxNeeded - nDrivers)
    gapTotal += gap
    out.push({ code: h.code, name: h.name, city: h.city, drivers: nDrivers, cells, totalKnown: tk, totalExpected: te, peakLoad: Math.round(peak * 100) / 100, gap })
  }

  return {
    day, generatedAt: new Date(nowMs).toISOString(), perDriverPerSlot: perDriver, historyDays: useDays.length, slots, hubs: out, totals,
    summary: {
      known: out.reduce((s, h) => s + h.totalKnown, 0), expected: out.reduce((s, h) => s + h.totalExpected, 0),
      saturatedCells: saturated, tenseCells: tense, driversGap: gapTotal, drivers: out.reduce((s, h) => s + h.drivers, 0),
    },
  }
}

// ─── LIVE ────────────────────────────────────────────────────────────────────
export interface LiveHub {
  code: string; name: string; city: string; drivers: number; total: number
  byStatus: Record<string, number>; late: number; atRisk: number; done: number; noShow: number
  onTimeRate: number | null; pctDone: number
  bySlot: Record<string, { total: number; done: number; late: number }>
}
export interface LivePoint { id: string; lat: number; lng: number; late: boolean; status: string; hubCode: string; slot: string; district: string | null }
export interface LiveDriver { code: string; name: string; hubCode: string | null; active: number; late: number; done: number }
export interface LiveResult {
  now: string; day: string
  totals: { total: number; done: number; late: number; atRisk: number; unassigned: number; pctDone: number; carriedOver: number }
  hubs: LiveHub[]; points: LivePoint[]; drivers: LiveDriver[]
}

export function isLate(o: OrderLite, nowMs: number) { return !DONE.has(o.status) && nowMs > t(o.slotEnd) }
export function isAtRisk(o: OrderLite, nowMs: number) {
  return !DONE.has(o.status) && o.status !== 'START_DELIVERY' && nowMs <= t(o.slotEnd) && t(o.slotEnd) - nowMs < 45 * MIN
}

export function liveSnapshot(orders: OrderLite[], hubs: HubLite[], drivers: DriverLite[], nowMs: number, opts: { city?: string | null; hub?: string | null } = {}): LiveResult {
  const day = localDay(nowMs)
  const dayStart = Date.parse(day + 'T00:00:00Z') - TZ_MS
  const hubList = hubs.filter(h => (!opts.city || h.city === opts.city.toUpperCase()) && (!opts.hub || h.code === opts.hub))
  const codes = new Set(hubList.map(h => h.code))
  // périmètre : créneaux du jour + reliquat non terminé des jours précédents (retards de la veille)
  const scope = orders.filter(o => codes.has(o.hubCode) && !(t(o.createdAt) > nowMs) &&
    ((t(o.slotStart) >= dayStart && t(o.slotStart) < dayStart + DAY) || (t(o.slotStart) < dayStart && !DONE.has(o.status))))

  const hubsOut: LiveHub[] = hubList.map(h => {
    const mine = scope.filter(o => o.hubCode === h.code)
    const byStatus: Record<string, number> = {}
    const bySlot: LiveHub['bySlot'] = {}
    let late = 0, atRisk = 0, done = 0, noShow = 0, onTime = 0, delivered = 0
    for (const o of mine) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1
      const s = slotLabelOf(o); const c = (bySlot[s] ||= { total: 0, done: 0, late: 0 })
      c.total++
      if (DONE.has(o.status)) { done++; c.done++; if (o.status === 'NO_SHOW') noShow++; else { delivered++; if (t(o.deliveredAt) <= t(o.slotEnd)) onTime++ } }
      else if (isLate(o, nowMs)) { late++; c.late++ } else if (isAtRisk(o, nowMs)) atRisk++
    }
    return {
      code: h.code, name: h.name, city: h.city, drivers: drivers.filter(d => d.hubCode === h.code).length, total: mine.length, byStatus, late, atRisk, done, noShow,
      onTimeRate: delivered ? Math.round((onTime / delivered) * 100) : null, pctDone: mine.length ? Math.round((done / mine.length) * 100) : 0, bySlot,
    }
  })

  const active = scope.filter(o => !DONE.has(o.status))
  const points: LivePoint[] = active.filter(o => o.lat && o.lng).slice(0, 1500).map(o => ({
    id: o.id, lat: o.lat as number, lng: o.lng as number, late: isLate(o, nowMs), status: o.status, hubCode: o.hubCode, slot: slotLabelOf(o), district: o.district,
  }))

  const dMap = new Map<string, LiveDriver>()
  for (const d of drivers) if (codes.has(d.hubCode || '')) dMap.set(d.code, { code: d.code, name: `${d.firstName} ${d.lastName}`, hubCode: d.hubCode, active: 0, late: 0, done: 0 })
  for (const o of scope) {
    const d = o.driverCode ? dMap.get(o.driverCode) : undefined; if (!d) continue
    if (DONE.has(o.status)) d.done++; else { d.active++; if (isLate(o, nowMs)) d.late++ }
  }

  const done = hubsOut.reduce((s, h) => s + h.done, 0)
  return {
    now: new Date(nowMs).toISOString(), day,
    totals: {
      total: scope.length, done, late: hubsOut.reduce((s, h) => s + h.late, 0), atRisk: hubsOut.reduce((s, h) => s + h.atRisk, 0),
      unassigned: scope.filter(o => o.status === 'READY_PICKUP').length, pctDone: scope.length ? Math.round((done / scope.length) * 100) : 0,
      carriedOver: scope.filter(o => t(o.slotStart) < dayStart).length,
    },
    hubs: hubsOut, points, drivers: [...dMap.values()].sort((a, b) => b.late - a.late || b.active - a.active),
  }
}
