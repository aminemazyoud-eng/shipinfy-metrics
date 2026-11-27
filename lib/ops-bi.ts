/**
 * lib/ops-bi.ts — Dashboard analytique « Control Tower » (8 onglets).
 * Port fidèle de la logique du HTML de référence (AS OPERATIONS V4) : mêmes règles de créneaux, de ponctualité,
 * de lead times, de distances et de récurrence — mais alimenté par l'API (lignes `BiRaw`) au lieu d'un CSV.
 * Fonctions pures, sans dépendance serveur : importables côté navigateur ET testables sous Node.
 */
import { localParts as casaParts } from '@/lib/tz'

// ─────────────────────────── Types ───────────────────────────
/** Ligne renvoyée par GET /api/ops/bi/orders (équivalent des 22 colonnes du CSV d'export). */
export interface BiRaw {
  id: string
  hub: string | null; hubLat: number | null; hubLng: number | null
  status: string | null
  createdAt: string | null; assignedAt: string | null; inTransportAt: string | null; startDeliveryAt: string | null; deliveredAt: string | null
  slotStart: string | null; slotEnd: string | null
  attempt: number | null; amount: number | null
  lat: number | null; lng: number | null
  phone: string | null; firstName: string | null
  driverId: string | null; driver: string | null
  updatedAt: string | null
}

export type TzMode = 'auto' | '1' | '0'
export type Grain = 'day' | 'week' | 'month'
export type Punctual = 'early' | 'ontime' | 'late' | null

export interface BiRow {
  id: string; day: string; hub: string; status: string; amount: number; attempt: number
  slot: string; slotDiff: number; punctual: Punctual; late: number | null; overdue: boolean
  lead: (number | null)[]; anticipation: number | null; dist: number | null
  gps: { lon: number; lat: number } | null; hubgps: { lon: number; lat: number } | null
  customer: string; firstname: string; driverId: string; driver: string
  time: number; update: number; raw: BiRaw
}

export interface Card { label: string; value: string; note: string }
export interface Tbl { head: string[]; rows: string[][] }
export type Series = [string, number][]

// ─────────────────────────── Constantes & formats ───────────────────────────
export const SLOTS = ['09h–12h', '12h–15h', '15h–18h', '18h–21h'] as const
export const DIST_NAMES = ['0–3 km', '3–6 km', '6–9 km', '9–12 km', '>12 km', 'GPS absent']
export const LT_NAMES = ['LT1 · Assignation', 'LT2 · Mise en transport', 'LT3 · Attente avant livraison', 'LT4 · Livraison']
export const WEEK_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const PAIRS: [keyof BiRaw, keyof BiRaw][] = [['createdAt', 'assignedAt'], ['assignedAt', 'inTransportAt'], ['inTransportAt', 'startDeliveryAt'], ['startDeliveryAt', 'deliveredAt']]
export const PAIR_LABELS = PAIRS.map(([a, b]) => [String(a), String(b)])

const nf = new Intl.NumberFormat('fr-FR')
const moneyNf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

export const n = (x: number | null | undefined): string => (fin(x) ? nf.format(x) : '—')
export const pct = (a: number, b: number): string => (b ? ((a / b) * 100).toFixed(1).replace('.', ',') + ' %' : '—')
export const avg = (a: number[]): number | null => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
export const fix = (a: number | null | undefined, d = 1): string => (fin(a) ? a.toFixed(d).replace('.', ',') : '—')
export const money = (x: number): string => moneyNf.format(x) + ' MAD'
export const dur = (v: number | null | undefined): string =>
  fin(v) ? (v < 0 ? '−' : '') + Math.floor(Math.round(Math.abs(v)) / 60) + ' h ' + String(Math.round(Math.abs(v)) % 60).padStart(2, '0') + ' min' : '—'
export function qtile(a: number[], q: number): number | null {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y), p = (s.length - 1) * q, l = Math.floor(p), f = p - l
  return s[l] * (1 - f) + (s[Math.min(l + 1, s.length - 1)] || s[l]) * f
}
export const card = (label: string, value: string, note = ''): Card => ({ label, value, note })

export function parseDate(v: unknown): number {
  if (!v) return NaN
  const t = Date.parse(String(v).trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isFinite(t) ? t : NaN
}
export function haversine(a: number, b: number, c: number, d: number): number {
  const r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r
  const s = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(s)))
}

export type LocalFn = (ts: number) => { day: string; hour: number; minute: number } | null
/** Heure locale d'affichage : UTC+1 / UTC+0 fixes (comme le HTML) ou Casablanca réel (Ramadan inclus). */
export function makeLocal(tz: TzMode): LocalFn {
  return (ts: number) => {
    if (!Number.isFinite(ts)) return null
    if (tz === 'auto') { const p = casaParts(ts); return { day: p.day, hour: p.hour, minute: p.minute } }
    const d = new Date(ts + (tz === '0' ? 0 : 3_600_000))
    return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
  }
}

// ─────────────────────────── Préparation d'une ligne (prepV3) ───────────────────────────
const validGps = (lon: number, lat: number) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 && lon !== 0 && lat !== 0

export function prepBi(raw: BiRaw, lp: LocalFn): BiRow {
  const sent = parseDate(raw.createdAt), asg = parseDate(raw.assignedAt), trn = parseDate(raw.inTransportAt), sd = parseDate(raw.startDeliveryAt)
  const td = parseDate(raw.deliveredAt), t0 = parseDate(raw.slotStart), t1 = parseDate(raw.slotEnd), tu = parseDate(raw.updatedAt)
  const status = raw.status || 'Inconnu'
  const delivered = status === 'DELIVERED'
  const st = lp(t0), h = st ? st.hour + st.minute / 60 : NaN, duration = (t1 - t0) / 3_600_000
  const idx = SLOTS.findIndex((_, i) => Math.abs(h - (9 + 3 * i)) <= 0.25 && duration >= 2.5 && duration <= 3.5)
  const slot = idx >= 0 ? SLOTS[idx] : 'atypical'
  const punctual: Punctual = delivered && fin(td) && fin(t0) && fin(t1) && t1 >= t0 ? (td < t0 ? 'early' : td > t1 ? 'late' : 'ontime') : null
  const late = punctual === 'late' ? (td - t1) / 60000 : null
  const overdue = !delivered && fin(tu) && fin(t1) && tu > t1
  const xlon = Number(raw.lng), xlat = Number(raw.lat)
  const gps = raw.lng != null && raw.lat != null && validGps(xlon, xlat)
  const hubgps = raw.hubLat != null && raw.hubLng != null && validGps(Number(raw.hubLng), Number(raw.hubLat))
  const dist = gps && hubgps ? haversine(Number(raw.hubLat), Number(raw.hubLng), xlat, xlon) : null
  const stamps = [sent, asg, trn, sd, td]
  const lead = [0, 1, 2, 3].map(i => {
    const d = (stamps[i + 1] - stamps[i]) / 60000
    return i === 3 && !delivered ? null : Number.isFinite(d) && d >= 0 ? d : null
  })
  const ant = (t0 - sent) / 60000
  const lt = lp(sent)
  return {
    id: raw.id, day: lt?.day || '', hub: raw.hub || 'Non renseigné', status, amount: Number(raw.amount) || 0, attempt: Number(raw.attempt),
    slot, slotDiff: idx >= 0 ? 0 : NaN, punctual, late, overdue, lead, anticipation: Number.isFinite(ant) ? ant : null, dist,
    gps: gps ? { lon: xlon, lat: xlat } : null, hubgps: hubgps ? { lon: Number(raw.hubLng), lat: Number(raw.hubLat) } : null,
    customer: (raw.phone || '').replace(/\D/g, ''), firstname: raw.firstName || '', driverId: raw.driverId || '',
    driver: raw.driver?.trim() || 'Non renseigné', time: sent, update: tu, raw,
  }
}

// ─────────────────────────── Utilitaires de groupement ───────────────────────────
export function group<T>(a: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of a) { const k = key(r); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]) }
  return m
}
export const groupCount = <T,>(a: T[], key: (r: T) => string): [string, number][] =>
  [...group(a, key)].map(([k, v]) => [k, v.length] as [string, number]).sort((x, y) => y[1] - x[1])
export function dateDays(a: string, b: string): number {
  if (!a || !b) return 0
  return Math.max(0, Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1)
}
export function weekKey(day: string): string {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const y = d.getUTCFullYear(), s = new Date(Date.UTC(y, 0, 1))
  return y + '-S' + String(Math.ceil(((d.getTime() - s.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')
}
const periodOf = (day: string, g: Grain) => (g === 'day' ? day : g === 'month' ? day.slice(0, 7) : weekKey(day))
export const hubsOf = (a: BiRow[]): string[] => [...new Set(a.map(r => r.hub))].sort()
const scope = (a: BiRow[], hub: string) => (hub ? a.filter(r => r.hub === hub) : a)
const wdIndex = (r: BiRow) => (new Date(r.day + 'T00:00:00Z').getUTCDay() + 6) % 7
const TOTAL = 'TOTAL'

/** Sélecteurs propres à chaque bloc (menus « Tous les magasins » du HTML). */
export interface Sel {
  start: string; end: string; grain: Grain; volumeGrain: Grain; weekdayMetric: 'total' | 'average' | 'share'
  prepHub: string; slotHub: string; onTimeHub: string; lateHub: string; attemptHub: string; attemptLateHub: string
  leadHub: string; leadSlotHub: string; anticipationHub: string
  driverView: 'driver' | 'hub'; driverSelect: string; driverDetailMode: 'hub' | 'day' | 'slot'
  geoHub: string; clientHub: string; clientTableHub: string; valueHub: string; valueSlotHub: string; valueGrain: Grain
}
export const DEFAULT_SEL: Sel = {
  start: '', end: '', grain: 'week', volumeGrain: 'day', weekdayMetric: 'total',
  prepHub: '', slotHub: '', onTimeHub: '', lateHub: '', attemptHub: '', attemptLateHub: '', leadHub: '', leadSlotHub: '', anticipationHub: '',
  driverView: 'driver', driverSelect: '', driverDetailMode: 'hub', geoHub: '', clientHub: '', clientTableHub: '', valueHub: '', valueSlotHub: '', valueGrain: 'week',
}

// ─────────────────────────── Onglet 1 · Vue générale ───────────────────────────
export function overviewData(a: BiRow[], s: Sel, lp: LocalFn) {
  const days = dateDays(s.start, s.end), byHub = groupCount(a, r => r.hub)
  const byPeriod = groupCount(a, r => periodOf(r.day, s.volumeGrain)).sort((x, y) => x[0].localeCompare(y[0]))
  const byPivot = groupCount(a, r => periodOf(r.day, s.grain)).sort((x, y) => x[0].localeCompare(y[0]))
  const total = a.reduce((q, r) => q + r.amount, 0), del = a.filter(x => x.status === 'DELIVERED')
  const metrics = [
    card('Commandes', n(a.length), 'références uniques'), card('Valeur déclarée', money(total), 'montant à encaisser (COD)'),
    card('Moy. / jour', fix(days ? a.length / days : null), 'jours calendaires : ' + days), card('Moy. / semaine', fix(days ? (a.length * 7) / days : null), 'base 7 jours'),
    card('Taux de livraison', pct(del.length, a.length), n(del.length) + ' / ' + n(a.length) + ' commandes'),
  ]
  const statusChips = groupCount(a, r => r.status).map(([status, count]) => ({ status, count, share: pct(count, a.length), good: status === 'DELIVERED' }))

  // Jours de la semaine
  const periodDays: number[] = []
  if (s.start && s.end) for (let d = new Date(s.start + 'T00:00:00Z'), e = new Date(s.end + 'T00:00:00Z'); d <= e && periodDays.length < 5000; d.setUTCDate(d.getUTCDate() + 1)) periodDays.push((d.getUTCDay() + 6) % 7)
  const counts = WEEK_NAMES.map((_, i) => periodDays.filter(x => x === i).length)
  const global = WEEK_NAMES.map((_, i) => a.filter(r => r.day && wdIndex(r) === i).length)
  const m = s.weekdayMetric
  const weekdaySeries: Series = WEEK_NAMES.map((name, i) => [name, m === 'total' ? global[i] : m === 'average' ? (counts[i] ? global[i] / counts[i] : 0) : a.length ? (100 * global[i]) / a.length : 0])
  const cell = (z: BiRow[], i: number) => {
    const c = z.filter(x => wdIndex(x) === i).length, nd = counts[i]
    return m === 'share' ? pct(c, z.length) : m === 'average' ? fix(nd ? c / nd : 0) : n(c)
  }
  const vsd = (z: BiRow[]) => z.filter(r => wdIndex(r) >= 4).length
  const weekdayRows = byHub.map(([hub]) => { const z = a.filter(x => x.hub === hub); return [hub, ...WEEK_NAMES.map((_, i) => cell(z, i)), n(vsd(z)), pct(vsd(z), z.length), n(z.length)] })
  weekdayRows.push([TOTAL, ...WEEK_NAMES.map((_, i) => cell(a, i)), n(vsd(a)), pct(vsd(a), a.length), n(a.length)])

  // Heures de transmission
  const z = scope(a, s.prepHub)
  const hourOf = (r: BiRow) => lp(r.time)?.hour
  const hours: Series = Array.from({ length: 24 }, (_, h) => [String(h).padStart(2, '0') + 'h', z.filter(r => hourOf(r) === h).length])
  const allHubs = hubsOf(a)
  const hourlyRows = Array.from({ length: 24 }, (_, i) => {
    const row = [String(i).padStart(2, '0') + 'h']
    for (const hub of allHubs) { const h = a.filter(r => r.hub === hub), c = h.filter(r => hourOf(r) === i).length; row.push(n(c) + ' (' + pct(c, h.length) + ')') }
    const sum = a.filter(r => hourOf(r) === i).length
    return [...row, n(sum) + ' (' + pct(sum, a.length) + ')']
  }).filter(row => row.slice(1).some(c => !c.startsWith('0 (')))
  hourlyRows.push([TOTAL, ...allHubs.map(h => n(a.filter(r => r.hub === h).length) + ' (100 %)'), n(a.length) + ' (100 %)'])

  // TCD magasin × période
  const pkeys = byPivot.map(x => x[0])
  const pivotRows = byHub.map(([hub]) => {
    const zz = a.filter(x => x.hub === hub), mp = new Map(groupCount(zz, r => periodOf(r.day, s.grain)))
    return [hub, ...pkeys.map(k => n(mp.get(k) || 0)), n(zz.length), pct(zz.length, a.length), fix(days ? zz.length / days : null), fix(days ? (zz.length * 7) / days : null)]
  })
  pivotRows.push([TOTAL, ...pkeys.map(k => n(byPivot.find(x => x[0] === k)?.[1] || 0)), n(a.length), pct(a.length, a.length), fix(days ? a.length / days : null), fix(days ? (a.length * 7) / days : null)])
  const pivot: Tbl = { head: ['Magasin', ...pkeys, 'Total', 'Part', 'Moy./jour', 'Moy./sem.'], rows: pivotRows }
  const pivotCsv = [pivot.head, ...pivot.rows].map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n')

  return {
    metrics, statusChips, volume: byPeriod, hubBars: byHub as Series, hubDenom: a.length,
    weekday: { series: weekdaySeries, share: m === 'share', table: { head: ['Magasin', ...WEEK_NAMES, 'VSD', 'VSD %', 'Total'], rows: weekdayRows } as Tbl },
    prepHour: { series: hours, denom: z.length, table: { head: ['Heure', ...allHubs, 'TOTAL'], rows: hourlyRows } as Tbl },
    pivot, pivotCsv,
  }
}

// ─────────────────────────── Onglet 2 · Créneaux & ponctualité ───────────────────────────
const LATE_BINS: [string, (x: number) => boolean][] = [['< 30 min', x => x < 30], ['30 min–1 h', x => x >= 30 && x < 60], ['1–2 h', x => x >= 60 && x < 120], ['2–3 h', x => x >= 120 && x < 180], ['≥ 3 h', x => x >= 180]]

export function slotsData(base: BiRow[], s: Sel) {
  const dAll = base.filter(x => x.status === 'DELIVERED'), over = base.filter(x => x.overdue)
  const cls = (z: BiRow[]) => z.filter(x => x.punctual)
  const of = (z: BiRow[], p: Punctual) => z.filter(x => x.punctual === p)
  const metrics = [
    card('Taux de livraison', pct(dAll.length, base.length), n(dAll.length) + ' / ' + n(base.length)),
    card('À l’heure', pct(of(base, 'ontime').length, cls(base).length), n(of(base, 'ontime').length)),
    card('En avance', pct(of(base, 'early').length, cls(base).length), n(of(base, 'early').length)),
    card('En retard confirmé', pct(of(base, 'late').length, cls(base).length), n(of(base, 'late').length)),
    card('Non livrées · créneau dépassé', n(over.length), pct(over.length, base.length) + ' des commandes'),
    card('Créneaux atypiques', n(base.filter(x => x.slot === 'atypical').length), pct(base.filter(x => x.slot === 'atypical').length, base.length)),
  ]
  const keys = [...SLOTS, 'atypical']
  const sl = scope(base, s.slotHub)
  const slotChart: Series = keys.map(k => [k === 'atypical' ? 'Atypique' : k, sl.filter(r => r.slot === k).length])
  const onCl = cls(scope(base, s.onTimeHub).filter(r => r.status === 'DELIVERED'))
  const ontimeChart: Series = [['En avance', of(onCl, 'early').length], ['À l’heure', of(onCl, 'ontime').length], ['En retard', of(onCl, 'late').length]]
  const g = groupCount(base, r => r.hub)
  const slotTable: Tbl = {
    head: ['Magasin', ...SLOTS, 'Atypique', 'Total'],
    rows: [...g.map(([hub]) => { const z = base.filter(x => x.hub === hub); return [hub, ...keys.map(k => { const c = z.filter(x => x.slot === k).length; return n(c) + ' (' + pct(c, z.length) + ')' }), n(z.length)] }),
      [TOTAL, ...keys.map(k => { const c = base.filter(x => x.slot === k).length; return n(c) + ' (' + pct(c, base.length) + ')' }), n(base.length)]],
  }
  const ret = of(scope(base, s.lateHub), 'late')
  const lateTable: Tbl = { head: ['Retard', 'Commandes', 'Part des retards'], rows: [...LATE_BINS.map(([l, fn]) => { const c = ret.filter(x => fn(x.late as number)).length; return [l, n(c), pct(c, ret.length)] }), [TOTAL, n(ret.length), pct(ret.length, ret.length)]] }
  const lateExplain = 'Base : ' + n(ret.length) + ' livraisons réalisées après la fin réelle du créneau promis.'
  const at = scope(base, s.attemptHub), attempts = [0, 1, 2, 3, 4]
  const attRow = (name: string, z: BiRow[]) => [name, ...attempts.map(t => n(z.filter(x => x.attempt === t).length)), n(z.filter(x => x.attempt >= 5).length), n(z.length)]
  const attemptTable: Tbl = { head: ['Statut', '0 tent.', '1 tent.', '2 tent.', '3 tent.', '4 tent.', '5+', 'Total'], rows: [...groupCount(at, x => x.status).map(([st]) => attRow(st, at.filter(x => x.status === st))), attRow(TOTAL, at)] }
  const detail = g.map(([hub]) => {
    const z = base.filter(x => x.hub === hub), del = z.filter(x => x.status === 'DELIVERED'), c = cls(del), on = of(c, 'ontime'), l = of(c, 'late'), multi = z.filter(x => x.attempt >= 2)
    return [hub, n(z.length), n(del.length), pct(del.length, z.length), n(on.length), pct(on.length, c.length), n(l.length), pct(l.length, c.length), n(z.filter(x => x.overdue).length), n(multi.length), pct(multi.length, z.length)]
  })
  const allC = cls(base), allOn = of(allC, 'ontime'), allLate = of(allC, 'late'), allMulti = base.filter(x => x.attempt >= 2)
  detail.push([TOTAL, n(base.length), n(dAll.length), pct(dAll.length, base.length), n(allOn.length), pct(allOn.length, allC.length), n(allLate.length), pct(allLate.length, allC.length), n(over.length), n(allMulti.length), pct(allMulti.length, base.length)])
  const slotHubDetail: Tbl = { head: ['Magasin', 'Commandes', 'Livrées', 'Taux livré', 'À l’heure', 'À l’heure %', 'En retard', 'Retard %', 'Non livrées · dépassé', '≥ 2 tent.', '≥ 2 tent. %'], rows: detail }
  const hubs = [...group(base, r => r.hub).keys()].sort(), totalLate = of(base, 'late')
  const lateCross: Tbl = {
    head: ['Palier', ...hubs, 'TOTAL'],
    rows: [...LATE_BINS.map(([name, fn]) => { const all = totalLate.filter(x => fn(x.late as number)).length; return [name, ...hubs.map(h => { const q = totalLate.filter(r => r.hub === h), c = q.filter(x => fn(x.late as number)).length; return n(c) + ' (' + pct(c, q.length) + ')' }), n(all) + ' (' + pct(all, totalLate.length) + ')'] }),
      [TOTAL, ...hubs.map(h => n(totalLate.filter(r => r.hub === h).length) + ' (100 %)'), n(totalLate.length) + ' (100 %)']],
  }
  const mx = scope(base, s.attemptLateHub)
  const cmp = (name: string, z: BiRow[]) => { const d = z.filter(x => x.status === 'DELIVERED'), c = cls(d), l = of(c, 'late'), o = of(c, 'ontime'); return [name, n(d.length), n(c.length), n(o.length), pct(o.length, c.length), n(l.length), pct(l.length, c.length)] }
  const attemptLateTable: Tbl = { head: ['Tentatives', 'Livrées', 'Classifiables', 'À l’heure', 'À l’heure %', 'En retard', 'Retard %'], rows: [cmp('1 tentative', mx.filter(x => x.attempt === 1)), cmp('2 tentatives ou +', mx.filter(x => x.attempt >= 2)), cmp(TOTAL, mx)] }
  return { metrics, slotChart, slotDenom: sl.length, ontimeChart, ontimeDenom: onCl.length, slotTable, lateTable, lateExplain, attemptTable, slotHubDetail, lateCross, attemptLateTable }
}

// ─────────────────────────── Onglet 3 · Lead Times ───────────────────────────
export function leadData(a: BiRow[], s: Sel) {
  const all = LT_NAMES.map((_, i) => a.map(x => x.lead[i]).filter((v): v is number => v !== null))
  const none = a.filter(x => x.lead.some(v => v === null)).length
  const inverted = (r: BiRow, [k, j]: [keyof BiRaw, keyof BiRaw]) => { const p = parseDate(r.raw[k]), q = parseDate(r.raw[j]); return Number.isFinite(p) && Number.isFinite(q) && q < p }
  const bad = a.filter(x => PAIRS.some(p => inverted(x, p))).length
  const metrics = [...all.map((z, i) => card(LT_NAMES[i], dur(avg(z)), 'méd. ' + dur(qtile(z, 0.5)) + ' · P90 ' + dur(qtile(z, 0.9)) + ' · n=' + n(z.length))), card('Délais non calculables', n(none), 'dont ' + n(bad) + ' chronologies inversées')]
  const vals = (z: BiRow[], i: number) => z.map(x => x.lead[i]).filter((v): v is number => v !== null)
  const leadTable: Tbl = { head: ['Magasin', 'Commandes', ...LT_NAMES.map(x => x + ' moy.')], rows: [...groupCount(a, r => r.hub).map(([hub, c]) => { const z = a.filter(x => x.hub === hub); return [hub, n(c), ...LT_NAMES.map((_, i) => dur(avg(vals(z, i))))] }), [TOTAL, n(a.length), ...all.map(x => dur(avg(x)))]] }

  const z = scope(a, s.leadHub), zAll = LT_NAMES.map((_, i) => vals(z, i))
  const maxDetail = zAll.map((v, i) => {
    const max = v.length ? Math.max(...v) : null
    const r = max === null ? null : z.find(x => x.lead[i] === max)
    return r ? { step: LT_NAMES[i], id: r.id, hub: r.hub, max, a: PAIR_LABELS[i][0], aTs: parseDate(r.raw[PAIRS[i][0]]), b: PAIR_LABELS[i][1], bTs: parseDate(r.raw[PAIRS[i][1]]) } : null
  })
  const leadDist: Tbl = { head: ['Étape', 'Valides', 'Moyenne', 'Médiane (P50)', 'P90', 'Max'], rows: zAll.map((v, i) => [LT_NAMES[i], n(v.length), dur(avg(v)), dur(qtile(v, 0.5)), dur(qtile(v, 0.9)), dur(v.length ? Math.max(...v) : null)]) }
  const leadIssues: Tbl = {
    head: ['Étape', 'Dates manquantes / invalides', 'Chronologies inversées', 'Valides'],
    rows: PAIRS.map((p, i) => [LT_NAMES[i], n(z.filter(r => !Number.isFinite(parseDate(r.raw[p[0]])) || !Number.isFinite(parseDate(r.raw[p[1]]))).length), n(z.filter(r => inverted(r, p)).length), n(zAll[i].length)]),
  }
  const az = scope(a, s.anticipationHub)
  const t = (r: BiRow) => r.time, st0 = (r: BiRow) => parseDate(r.raw.slotStart), en = (r: BiRow) => parseDate(r.raw.slotEnd)
  const before = az.filter(r => Number.isFinite(t(r)) && Number.isFinite(st0(r)) && t(r) < st0(r))
  const within = az.filter(r => Number.isFinite(t(r)) && Number.isFinite(st0(r)) && Number.isFinite(en(r)) && t(r) >= st0(r) && t(r) <= en(r))
  const after = az.filter(r => Number.isFinite(t(r)) && Number.isFinite(en(r)) && t(r) > en(r))
  const beforeVals = before.map(x => x.anticipation).filter((v): v is number => v !== null)
  const tot = before.length + within.length + after.length
  const anticipationTable: Tbl = { head: ['Transmission', 'Commandes', 'Part', 'Délai moyen avant début'], rows: [['Avant début de créneau', n(before.length), pct(before.length, az.length), dur(avg(beforeVals))], ['Pendant le créneau', n(within.length), pct(within.length, az.length), '—'], ['Après fin du créneau', n(after.length), pct(after.length, az.length), '—'], [TOTAL, n(tot), pct(tot, az.length), '—']] }
  const q = scope(a, s.leadSlotHub), glob = q.filter(x => x.punctual)
  const slotRow = (name: string, zz: BiRow[]) => {
    const c = zz.filter(x => x.punctual), on = c.filter(x => x.punctual === 'ontime'), l = c.filter(x => x.punctual === 'late')
    return [name, n(zz.length), ...LT_NAMES.map((_, j) => dur(avg(vals(zz, j)))), n(on.length), pct(on.length, c.length), n(l.length), pct(l.length, c.length)]
  }
  const leadSlots: Tbl = { head: ['Créneau', 'Commandes', ...LT_NAMES.map(x => x + ' moy.'), 'À l’heure', 'À l’heure %', 'Retards livrés', 'Taux retard'], rows: [...SLOTS.map(sl => slotRow(sl, q.filter(x => x.slot === sl))), slotRow(TOTAL, q)] }
  void glob
  return { metrics, leadTable, leadDist, maxDetail, leadIssues, anticipationTable, leadSlots }
}

// ─────────────────────────── Onglet 4 · Livreurs ───────────────────────────
export interface DriverGroup { key: string; label: string; cells: string[]; children: { label: string; cells: string[] }[] }
export function driversData(base: BiRow[], s: Sel) {
  const valid = base.filter(x => x.driverId || x.driver !== 'Non renseigné'), k = (r: BiRow) => r.driverId || 'name:' + r.driver
  const byDriver = group(valid, k), active = (z: BiRow[]) => new Set(z.map(r => r.day).filter(Boolean)).size
  const distinct = byDriver.size, unassigned = base.length - valid.length
  const avgDay = avg([...byDriver.values()].map(z => z.length / Math.max(1, active(z))))
  const deliveredDay = avg([...byDriver.values()].map(z => z.filter(r => r.status === 'DELIVERED').length / Math.max(1, active(z))))
  const metrics = [card('Livreurs distincts', n(distinct), 'sur la période'), card('Commandes / livreur / jour actif', fix(avgDay), 'moyenne des livreurs'), card('Livrées / livreur / jour actif', fix(deliveredDay), 'moyenne des livreurs'), card('Commandes sans livreur', n(unassigned), pct(unassigned, base.length))]
  const cells = (z: BiRow[]) => {
    const dl = z.filter(r => r.status === 'DELIVERED'), live = new Set(dl.map(k))
    return [n(z.length), n(dl.length), pct(dl.length, z.length), n(active(z)), fix(z.length / Math.max(1, active(z))), fix(dl.length / Math.max(1, active(z))), n(live.size), n(new Set(z.map(x => x.hub)).size), dur(avg(dl.map(r => r.lead[3]).filter((v): v is number => v !== null)))]
  }
  const byCount = (m: Map<string, BiRow[]>) => [...m].sort((x, y) => y[1].length - x[1].length)
  const groups: DriverGroup[] = s.driverView === 'driver'
    ? byCount(byDriver).map(([id, z]) => ({ key: id, label: z[0].driver, cells: cells(z), children: byCount(group(z, x => x.hub)).map(([h, w]) => ({ label: h, cells: cells(w) })) }))
    : byCount(group(valid, r => r.hub)).map(([hub, z]) => ({ key: hub, label: hub, cells: cells(z), children: byCount(group(z, k)).map(([, w]) => ({ label: w[0].driver, cells: cells(w) })) }))
  const options = [...byDriver].sort((x, y) => x[1][0].driver.localeCompare(y[1][0].driver)).map(([id, z]) => [id, z[0].driver] as [string, string])
  const chosen = s.driverSelect && byDriver.has(s.driverSelect) ? byDriver.get(s.driverSelect)! : valid
  const mode = s.driverDetailMode
  const label = (r: BiRow) => (mode === 'day' ? r.day : mode === 'slot' ? r.slot : r.hub)
  const dRow = (name: string, z: BiRow[]) => { const d = z.filter(r => r.status === 'DELIVERED'), c = d.filter(r => r.punctual), l = c.filter(r => r.punctual === 'late'), o = c.filter(r => r.punctual === 'ontime'); return [name, n(z.length), n(d.length), pct(d.length, z.length), n(o.length), pct(o.length, c.length), n(l.length), pct(l.length, c.length)] }
  const entries = [...group(chosen, label)].sort((x, y) => String(x[0]).localeCompare(String(y[0])))
  const detail: Tbl = { head: [mode === 'day' ? 'Jour de transmission' : mode === 'slot' ? 'Créneau' : 'Magasin', 'Commandes', 'Livrées', 'Taux livré', 'À l’heure', 'À l’heure %', 'En retard', 'Retard %'], rows: [...entries.map(([name, z]) => dRow(name, z)), dRow(TOTAL, chosen)] }
  return { metrics, head: ['Livreur / Magasin', 'Commandes', 'Livrées', 'Taux livré', 'Jours actifs', 'Cmd/jour actif', 'Livrées/jour actif', 'Livreurs actifs', 'Magasins', 'LT4 moyen'], groups, options, detail }
}

// ─────────────────────────── Onglet 5 · Géographie ───────────────────────────
const distBin = (r: BiRow) => { const d = r.dist; return d === null ? 5 : d < 3 ? 0 : d < 6 ? 1 : d < 9 ? 2 : d < 12 ? 3 : 4 }
export interface GeoPoint { lat: number; lon: number; punctual: Punctual }
export function geoData(a: BiRow[], s: Sel) {
  const filtered = scope(a, s.geoHub), valid = a.map(x => x.dist).filter((v): v is number => v !== null), allHubs = groupCount(a, r => r.hub)
  const withGps = a.filter(x => x.gps).length
  const metrics = [card('Commandes géolocalisées', n(withGps), pct(withGps, a.length)), card('Distance moyenne', fix(avg(valid)) + ' km', 'tous magasins · à vol d’oiseau'), card('Distance médiane', fix(qtile(valid, 0.5)) + ' km', 'tous magasins · à vol d’oiseau'), card('GPS manquants', n(a.length - valid.length), 'client et magasin')]
  const series: Series = DIST_NAMES.map((name, i) => [name, filtered.filter(x => distBin(x) === i).length])
  const distanceTable: Tbl = { head: ['Palier', 'Commandes', 'Part'], rows: [...series.map(([name, c]) => [name, n(c), pct(c, filtered.length)]), [TOTAL, n(filtered.length), pct(filtered.length, filtered.length)]] }
  const hubRow = (name: string, z: BiRow[]) => { const ds = z.map(x => x.dist).filter((v): v is number => v !== null); return [name, ...DIST_NAMES.map((_, i) => { const c = z.filter(x => distBin(x) === i).length; return n(c) + ' (' + pct(c, z.length) + ')' }), n(z.length), fix(avg(ds)) + ' km', fix(qtile(ds, 0.5)) + ' km'] }
  const distanceHub: Tbl = { head: ['Magasin', ...DIST_NAMES, 'Total', 'Moyenne', 'Médiane'], rows: [...allHubs.map(([hub]) => hubRow(hub, a.filter(x => x.hub === hub))), hubRow(TOTAL, a)] }
  const points: GeoPoint[] = a.filter(r => r.gps).map(r => ({ lat: r.gps!.lat, lon: r.gps!.lon, punctual: r.punctual }))
  const stores = new Map<string, { lat: number; lon: number }>()
  a.forEach(r => { if (r.hubgps) stores.set(r.hub, r.hubgps) })
  return { metrics, series, denom: filtered.length, distanceTable, distanceHub, points, stores: [...stores].map(([name, g]) => ({ name, ...g })) }
}

/** Agrège les points de la carte selon le mode (points / densité / retards) — équivalent de updateInteractiveMap. */
export function mapCells(pts: GeoPoint[], mode: 'dots' | 'density' | 'late') {
  const cells = new Map<string, { lat: number; lon: number; count: number; late: number }>()
  for (const r of pts) {
    const key = Math.round(r.lat * 130) / 130 + ',' + Math.round(r.lon * 130) / 130
    let v = cells.get(key)
    if (!v) { v = { lat: 0, lon: 0, count: 0, late: 0 }; cells.set(key, v) }
    v.lat += r.lat; v.lon += r.lon; v.count++; if (r.punctual === 'late') v.late++
  }
  const ds = mode === 'dots' ? pts.slice(0, 6000).map(r => ({ lat: r.lat, lon: r.lon, count: 1, late: r.punctual === 'late' ? 1 : 0, p: r.punctual as Punctual })) : [...cells.values()].map(v => ({ ...v, lat: v.lat / v.count, lon: v.lon / v.count, p: null as Punctual }))
  return ds.map(r => ({
    lat: r.lat, lon: r.lon, count: r.count, late: r.late,
    color: mode === 'late' ? (r.late / r.count > 0.25 ? '#dc354d' : r.late / r.count > 0.1 ? '#d49b33' : '#15a58c') : mode === 'density' ? '#e06d36' : r.p === 'late' ? '#d63e50' : r.p === 'early' || r.p === 'ontime' ? '#159c85' : '#a8b2c4',
    radius: mode === 'dots' ? 3 : Math.min(24, 4 + Math.sqrt(r.count) * 2),
  }))
}

// ─────────────────────────── Onglet 6 · Clients & récurrence ───────────────────────────
export function clientsData(a: BiRow[], s: Sel) {
  const hub = s.clientHub, tableHub = s.clientTableHub
  const all = group(a, r => r.customer || 'UNKNOWN:' + r.id), known = [...all].filter(([id]) => !id.startsWith('UNKNOWN:'))
  const forHub = (sel: string) => known.filter(([, z]) => !sel || z.some(r => r.hub === sel))
  const chart = forHub(hub), tbl = forHub(tableHub)
  const bins: [string, (v: number) => boolean][] = [['1', v => v === 1], ['2', v => v === 2], ['3', v => v === 3], ['4', v => v === 4], ['5–9', v => v >= 5 && v < 10], ['10–19', v => v >= 10 && v < 20], ['20–49', v => v >= 20 && v < 50], ['50+', v => v >= 50]]
  const recurrent = chart.filter(([, z]) => z.length >= 2)
  const metrics = [card('Clients identifiables', n(chart.length), 'numéros uniques'), card('Clients récurrents', n(recurrent.length), '≥ 2 commandes'), card('Taux de récurrence', pct(recurrent.length, chart.length), 'clients ≥ 2 / total clients'), card('Commandes sans mobile', n(a.filter(r => !r.customer && (!hub || r.hub === hub)).length), 'dans le périmètre')]
  const series: Series = bins.map(([label, fn]) => [label, chart.filter(([, z]) => fn(z.length)).length])
  const chunks = bins.map(([label, fn]) => [label, tbl.filter(([, z]) => fn(z.length))] as const)
  const clientTable: Tbl = { head: ['Fréquence', 'Clients', '% des clients', 'Commandes correspondantes'], rows: [...chunks.map(([name, items]) => [name, n(items.length), pct(items.length, tbl.length), n(items.reduce((q, [, z]) => q + z.length, 0))]), [TOTAL, n(tbl.length), '100 %', n(tbl.reduce((q, [, z]) => q + z.length, 0))]] }
  const freqs: ((v: number) => boolean)[] = [v => v === 1, v => v >= 2 && v <= 4, v => v >= 5 && v <= 9, v => v >= 10 && v <= 19, v => v >= 20]
  const crossRow = (name: string, list: BiRow[]) => {
    const clients = [...group(list, r => r.customer || 'UNKNOWN:' + r.id)].filter(([id]) => !id.startsWith('UNKNOWN:')), vals = clients.map(([, z]) => z.length), rec = vals.filter(v => v >= 2).length
    return [name, ...freqs.map(fn => { const c = vals.filter(fn).length; return n(c) + ' (' + pct(c, clients.length) + ')' }), n(clients.length), n(rec), pct(rec, clients.length)]
  }
  const stores = hubsOf(a)
  const clientCross: Tbl = { head: ['Magasin', '1 cmd', '2–4 cmd', '5–9 cmd', '10–19 cmd', '20+ cmd', 'Total clients', 'Récurrents', 'Taux récurrence'], rows: [...stores.map(h => crossRow(h, a.filter(r => r.hub === h))), crossRow(TOTAL, a)] }
  const list = (lo: number, hi: number): Tbl => {
    const items = chart.filter(([, z]) => z.length >= lo && z.length <= hi).sort((x, y) => y[1].length - x[1].length)
    return {
      head: ['Prénom', 'ID anonymisé', 'Cmd globales', 'Cmd magasin', 'Magasin principal', 'Magasins utilisés'],
      rows: items.map(([, z], i) => {
        const here = hub ? z.filter(r => r.hub === hub) : z
        return [groupCount(here, r => r.firstname?.trim() || 'Non renseigné')[0]?.[0] || 'Non renseigné', 'Client ' + String(i + 1).padStart(3, '0'), n(z.length), n(here.length), groupCount(here, r => r.hub)[0]?.[0] || '—', n(new Set(z.map(r => r.hub)).size)]
      }),
    }
  }
  return { metrics, series, clientTable, clientCross, topClients: list(20, Infinity), midClients: list(10, 19) }
}

// ─────────────────────────── Onglet 7 · Valeur déclarée ───────────────────────────
export function valueData(a: BiRow[], s: Sel) {
  const z = scope(a, s.valueHub), slotZ = scope(a, s.valueSlotHub), days = dateDays(s.start, s.end)
  const sum = (x: BiRow[]) => x.reduce((q, r) => q + r.amount, 0)
  const metrics = [card('Valeur déclarée', money(sum(a)), 'montant à encaisser (COD)'), card('Valeur / commande', money(a.length ? sum(a) / a.length : 0), 'panier moyen déclaré'), card('Valeur moyenne / jour', money(days ? sum(a) / days : 0), 'jours calendaires : ' + days), card('Commandes', n(a.length), 'périmètre général')]
  const p = (r: BiRow) => periodOf(r.day, s.valueGrain)
  const evolution: Series = [...group(z, p)].map(([key, arr]) => [key, sum(arr)] as [string, number]).sort((x, y) => x[0].localeCompare(y[0]))
  const byHub = [...group(a, r => r.hub)].map(([hub, arr]) => [hub, sum(arr), arr.length] as [string, number, number]).sort((x, y) => y[1] - x[1])
  const hubChart: Series = byHub.map(([h, t]) => [h, t])
  const hubTable: Tbl = { head: ['Magasin', 'Montant (MAD)', 'Part', 'Panier moyen'], rows: [...byHub.map(([h, t, c]) => [h, n(t), pct(t, sum(a)), money(t / c)]), [TOTAL, n(sum(a)), '100 %', money(a.length ? sum(a) / a.length : 0)]] }
  const slotSeries = [...SLOTS, 'atypical'].map(k => [k === 'atypical' ? 'Atypique' : k, slotZ.filter(x => x.slot === k)] as const)
  const slotChart: Series = slotSeries.map(([k, arr]) => [k, sum(arr)])
  const slotTable: Tbl = { head: ['Créneau', 'Valeur (MAD)', 'Part', 'Panier moyen'], rows: [...slotSeries.map(([name, arr]) => [name, n(sum(arr)), pct(sum(arr), sum(slotZ)), money(arr.length ? sum(arr) / arr.length : 0)]), [TOTAL, n(sum(slotZ)), '100 %', money(slotZ.length ? sum(slotZ) / slotZ.length : 0)]] }
  const periodsAll = [...group(a, p)].map(([key, arr]) => [key, sum(arr)] as [string, number]).sort((x, y) => x[0].localeCompare(y[0])), keys = periodsAll.map(([k]) => k)
  const pivot: Tbl = { head: ['Magasin', ...keys, 'Total', 'Part'], rows: [...byHub.map(([hub, t]) => { const m = new Map([...group(a.filter(x => x.hub === hub), p)].map(([k, rr]) => [k, sum(rr)] as [string, number])); return [hub, ...keys.map(k => n(m.get(k) || 0)), n(t), pct(t, sum(a))] }), [TOTAL, ...periodsAll.map(([, t]) => n(t)), n(sum(a)), '100 %']] }
  return { metrics, evolution, hubChart, hubDenom: sum(a), hubTable, slotChart, slotDenom: sum(slotZ), slotTable, pivot }
}

// ─────────────────────────── Onglet 8 · Qualité des données ───────────────────────────
export function qualityData(a: BiRow[], source: { name: string; lastSync: string | null }) {
  const atyp = a.filter(x => x.slot === 'atypical'), shift = a.filter(x => x.slot !== 'atypical' && x.slotDiff !== 0)
  const missing = (k: keyof BiRaw) => a.filter(x => !x.raw[k]).length
  const invalid = (['createdAt', 'assignedAt', 'inTransportAt', 'startDeliveryAt', 'deliveredAt'] as (keyof BiRaw)[]).map(k => [k, a.filter(x => x.raw[k] && !Number.isFinite(parseDate(x.raw[k]))).length] as [string, number])
  const metrics = [card('Source de données', 'API', source.name), card('Commandes uniques', n(a.length), 'après dédoublonnage'), card('Créneaux atypiques', n(atyp.length), pct(atyp.length, a.length)), card('Dernière synchro', source.lastSync ? new Date(source.lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—', 'back-office → Metrics')]
  const data: [string, number][] = [['Créneau non classifiable', atyp.length], ['Créneau avec décalage local', shift.length], ['Sans date de création', missing('createdAt')], ['Sans date de livraison', missing('deliveredAt')], ['Sans mobile client', missing('phone')], ['Sans identifiant livreur', missing('driverId')], ['Sans GPS client', a.filter(x => !x.gps).length], ['Sans distance calculable', a.filter(x => x.dist === null).length], ...invalid.map(([k, v]) => ['Date invalide : ' + k, v] as [string, number])]
  const table: Tbl = { head: ['Contrôle', 'Occurrences', '% des commandes'], rows: data.map(([k, v]) => [k, n(v), pct(v, a.length)]) }
  return { metrics, table }
}
