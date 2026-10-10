/**
 * lib/ops-route.ts — moteur de tournée (Agent C). PUR : aucune dépendance applicative sauf lib/geo.ts (haversine) et ops-config (défauts).
 *
 * Méthode : (1) regroupement par secteur puis plus-proche-voisin (NN) ; (2) découpage en rotations selon la capacité
 * (nombre de stops maximum par rotation) ; (3) dans chaque rotation, NN + amélioration 2-opt sur la distance haversine,
 * en gardant la variante qui produit le moins de retards sur les fenêtres de créneau ; (4) ETA par stop = départ + trajet + service.
 * Les distances sont à vol d'oiseau (haversine) × un facteur de détour (réglage) : ce n'est PAS un calcul routier.
 * Les réglages (temps de service, capacité, rotations, courbe de trafic…) sont stockés dans OpsSetting (clés « route.* » / « eta.* »).
 */
import { haversineM, validLatLng } from '@/lib/geo'
import { CFG } from '@/lib/ops-config'

export interface Pt { lat: number; lng: number }
/** Minutes de trajet entre deux points à l'instant `atMs` (null = position inconnue). */
export type TravelFn = (a: Pt | null, b: Pt | null, atMs: number) => number

// ── Réglages ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface RouteSettings {
  serviceMin: number          // temps de service par stop (min)
  maxStops: number            // capacité : stops max par rotation
  rotationsPerSlot: number    // rotations successives autorisées d'un même véhicule par créneau
  loadMin: number             // temps de chargement avant le départ d'une rotation (min)
  maxPostpones: number        // reports max par stop
  waveTarget: number          // taille cible d'un lot de préparation
  waveMax: number             // taille max d'un lot
  waveWidenMin: number        // fenêtre élargie par cut-off (min), 0 = désactivée
  etaDriftNotifyMin: number   // prévenir le client si l'ETA dérive de plus de N min
  baseSpeedKmh: number        // vitesse moyenne urbaine hors trafic
  roadFactor: number          // détour route / vol d'oiseau
  trafficCoef: number         // coefficient global de trafic (> 1 = plus lent)
  defaultLegMin: number       // trajet par défaut si coordonnées inconnues
  minLegMin: number           // trajet minimal entre deux stops
  trafficCurve: number[]      // 24 facteurs de vitesse par heure locale (1 = fluide, 0.6 = dense)
}

// Courbe de vitesse par heure locale (index = heure). Valeurs de départ plausibles, À CALIBRER avec vos données réelles.
export const DEFAULT_TRAFFIC_CURVE = [1.15, 1.15, 1.15, 1.15, 1.15, 1.1, 1.0, 0.8, 0.65, 0.7, 0.85, 0.85, 0.8, 0.75, 0.8, 0.85, 0.75, 0.65, 0.6, 0.7, 0.85, 0.95, 1.05, 1.1]

export const DEFAULT_ROUTE_SETTINGS: RouteSettings = {
  serviceMin: 8, maxStops: 3, rotationsPerSlot: 2, loadMin: 15, maxPostpones: 2,
  waveTarget: 3, waveMax: 4, waveWidenMin: 120, etaDriftNotifyMin: 20,
  baseSpeedKmh: 25, roadFactor: 1.3, trafficCoef: 1, defaultLegMin: 10, minLegMin: 3, trafficCurve: DEFAULT_TRAFFIC_CURVE,
}

/** Bornes de chaque réglage numérique [min, max]. */
const BOUNDS: Record<Exclude<keyof RouteSettings, 'trafficCurve'>, [number, number]> = {
  serviceMin: [0, 120], maxStops: [1, 40], rotationsPerSlot: [1, 6], loadMin: [0, 120], maxPostpones: [0, 10],
  waveTarget: [1, 20], waveMax: [1, 30], waveWidenMin: [0, 360], etaDriftNotifyMin: [5, 240],
  baseSpeedKmh: [5, 90], roadFactor: [1, 3], trafficCoef: [0.3, 5], defaultLegMin: [1, 120], minLegMin: [0, 30],
}
const KEYS: Record<keyof RouteSettings, string> = {
  serviceMin: 'route.serviceMin', maxStops: 'route.maxStops', rotationsPerSlot: 'route.rotationsPerSlot', loadMin: 'route.loadMin', maxPostpones: 'route.maxPostpones',
  waveTarget: 'route.waveTarget', waveMax: 'route.waveMax', waveWidenMin: 'route.waveWidenMin', etaDriftNotifyMin: 'eta.driftNotifyMin',
  baseSpeedKmh: 'eta.baseSpeedKmh', roadFactor: 'eta.roadFactor', trafficCoef: 'eta.trafficCoef', defaultLegMin: 'eta.defaultLegMin', minLegMin: 'eta.minLegMin', trafficCurve: 'eta.trafficCurve',
}
export const ROUTE_SETTING_KEYS = Object.values(KEYS)

/** Valide un jeu de réglages partiel (valeurs hors bornes / illisibles ignorées). Fonction pure. */
export function sanitizeRouteSettings(raw: Record<string, unknown>): Partial<RouteSettings> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]) {
    const v = raw[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= BOUNDS[k][0] && v <= BOUNDS[k][1]) out[k] = v
  }
  const c = raw.trafficCurve
  if (Array.isArray(c) && c.length === 24 && c.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0.2 && x <= 2)) out.trafficCurve = c.slice()
  return out as Partial<RouteSettings>
}

/** Lit les réglages (OpsSetting) ; défauts si base indisponible. Cache 20 s. */
let cache: { at: number; v: RouteSettings } | null = null
export async function loadRouteSettings(force = false): Promise<RouteSettings> {
  if (!force && cache && Date.now() - cache.at < 20_000) return cache.v
  const base: RouteSettings = { ...DEFAULT_ROUTE_SETTINGS, maxStops: Math.max(1, Math.round(CFG.perDriverPerSlot || DEFAULT_ROUTE_SETTINGS.maxStops)) }
  try {
    const { prisma } = await import('@/lib/prisma')
    const rows = await prisma.opsSetting.findMany({ where: { key: { in: ROUTE_SETTING_KEYS } } })
    const raw: Record<string, unknown> = {}
    const byKey = new Map(rows.map(r => [r.key, r.value]))
    for (const [field, key] of Object.entries(KEYS)) {
      const s = byKey.get(key)
      if (s == null) continue
      try { raw[field] = JSON.parse(s) } catch { /* valeur illisible ignorée */ }
    }
    const v = { ...base, ...sanitizeRouteSettings(raw) }
    cache = { at: Date.now(), v }
    return v
  } catch { return base }
}

export async function saveRouteSettings(patch: Record<string, unknown>): Promise<RouteSettings> {
  const clean = sanitizeRouteSettings(patch)
  const { prisma } = await import('@/lib/prisma')
  for (const [field, value] of Object.entries(clean)) {
    const key = KEYS[field as keyof RouteSettings]
    await prisma.opsSetting.upsert({ where: { key }, update: { value: JSON.stringify(value) }, create: { key, value: JSON.stringify(value) } })
  }
  return loadRouteSettings(true)
}

// ── Géométrie ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const toPt = (o: { lat?: number | null; lng?: number | null } | null | undefined): Pt | null =>
  o && validLatLng(o.lat, o.lng) ? { lat: o.lat as number, lng: o.lng as number } : null

const dist = (a: Pt, b: Pt) => haversineM(a.lat, a.lng, b.lat, b.lng)

/** Longueur (m) du chemin ouvert start → p[order[0]] → p[order[1]] … */
export function pathLengthM(start: Pt | null, pts: Pt[], order: number[]): number {
  let d = 0, prev: Pt | null = start
  for (const i of order) { if (prev) d += dist(prev, pts[i]); prev = pts[i] }
  return Math.round(d)
}

/** Plus-proche-voisin depuis `start` (ou depuis le premier point si start est inconnu). Renvoie les indices dans l'ordre de visite. */
export function nearestNeighbour(start: Pt | null, pts: Pt[]): number[] {
  const left = pts.map((_, i) => i), out: number[] = []
  let cur: Pt | null = start
  while (left.length) {
    let bi = 0, bd = Infinity
    if (cur) for (let k = 0; k < left.length; k++) { const d = dist(cur, pts[left[k]]); if (d < bd) { bd = d; bi = k } }
    const [i] = left.splice(bi, 1)
    out.push(i); cur = pts[i]
  }
  return out
}

/** Amélioration 2-opt d'un chemin OUVERT (départ fixe, fin libre). Ne dégrade jamais la longueur. */
export function twoOpt(start: Pt | null, pts: Pt[], order: number[], maxPasses = 50): number[] {
  const o = order.slice(), n = o.length
  if (n < 3) return o
  const at = (k: number): Pt | null => (k < 0 ? start : pts[o[k]])
  const d = (a: Pt | null, b: Pt | null) => (a && b ? dist(a, b) : 0)
  let improved = true, passes = 0
  while (improved && passes++ < maxPasses) {
    improved = false
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        // inverser o[i..j] : arêtes (i-1,i) et (j,j+1) remplacées par (i-1,j) et (i,j+1) ; j = n-1 → pas d'arête sortante
        const before = d(at(i - 1), at(i)) + (j < n - 1 ? d(at(j), at(j + 1)) : 0)
        const after = d(at(i - 1), at(j)) + (j < n - 1 ? d(at(i), at(j + 1)) : 0)
        if (after + 1e-6 < before) { const seg = o.slice(i, j + 1).reverse(); o.splice(i, j - i + 1, ...seg); improved = true }
      }
    }
  }
  return o
}

/** Position d'insertion (0..n) qui allonge le moins un chemin ouvert déjà ordonné. */
export function cheapestInsertion(start: Pt | null, path: Pt[], p: Pt): number {
  if (!path.length) return 0
  let best = 0, bd = Infinity
  for (let k = 0; k <= path.length; k++) {
    const prev = k === 0 ? start : path[k - 1], next = k < path.length ? path[k] : null
    const added = (prev ? dist(prev, p) : 0) + (next ? dist(p, next) : 0) - (prev && next ? dist(prev, next) : 0)
    if (added < bd) { bd = added; best = k }
  }
  return best
}

// ── ETA ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Heures d'arrivée (ms) à chaque stop : départ + trajet (selon l'heure) ; l'arrivée précède le temps de service. */
export function computeArrivals(start: Pt | null, startMs: number, stops: { pt: Pt | null; serviceMin: number }[], travel: TravelFn): number[] {
  const out: number[] = []
  let t = startMs, pos = start
  for (const s of stops) {
    t += travel(pos, s.pt, t) * 60_000
    out.push(Math.round(t))
    t += s.serviceMin * 60_000
    if (s.pt) pos = s.pt
  }
  return out
}

// ── Planification d'une journée de livreur ───────────────────────────────────────────────────────────────────────────────────
export interface RouteOrder { id: string; lat: number | null; lng: number | null; slot: string; slotStart: number; slotEnd: number; sector?: string | null }
export interface PlannedTour {
  slot: string; rotationInSlot: number; departAt: number; orderIds: string[]; arrivals: number[]
  lateIds: string[]        // stops dont l'ETA dépasse la fin de créneau
  overflow: boolean        // au-delà du nombre de rotations autorisées par créneau
  distanceM: number; returnAt: number
}
export interface PlanOptions { serviceMin: number; maxStops: number; rotationsPerSlot: number; loadMin: number; earliestMs?: number }

const lateIdsOf = (orders: RouteOrder[], arrivals: number[]) => orders.filter((o, i) => arrivals[i] > o.slotEnd).map(o => o.id)

/** Ordonne un lot : NN + 2-opt, variante la moins en retard (puis la plus courte). Renvoie des indices dans `orders`. */
export function sequenceStops(start: Pt | null, orders: RouteOrder[], departMs: number, travel: TravelFn, serviceMin: number): number[] {
  const withPt = orders.map((o, i) => ({ i, pt: toPt(o) })).filter(x => x.pt) as { i: number; pt: Pt }[]
  const noPt = orders.map((_, i) => i).filter(i => !toPt(orders[i]))
  const pts = withPt.map(x => x.pt)
  const nn = nearestNeighbour(start, pts)
  const opt = twoOpt(start, pts, nn)
  const toIdx = (ord: number[]) => [...ord.map(k => withPt[k].i), ...noPt]
  const score = (ord: number[]) => {
    const idx = toIdx(ord), seq = idx.map(i => orders[i])
    const arr = computeArrivals(start, departMs, seq.map(o => ({ pt: toPt(o), serviceMin })), travel)
    return { late: lateIdsOf(seq, arr).length, len: pathLengthM(start, pts, ord) }
  }
  const a = score(nn), b = score(opt)
  return toIdx(b.late < a.late || (b.late === a.late && b.len <= a.len) ? opt : nn)
}

/**
 * Plan d'une journée pour UN livreur : commandes groupées par créneau (ordre chronologique), secteur → proximité, découpées en rotations
 * de `maxStops` stops. La rotation suivante part au retour de la précédente (+ chargement). `start` = hub (null si inconnu).
 */
export function planDriverDay(orders: RouteOrder[], start: Pt | null, travel: TravelFn, p: PlanOptions): PlannedTour[] {
  const bySlot = new Map<string, RouteOrder[]>()
  for (const o of orders) (bySlot.get(o.slot) ?? bySlot.set(o.slot, []).get(o.slot)!).push(o)
  const slots = [...bySlot.entries()].sort((a, b) => Math.min(...a[1].map(o => o.slotStart)) - Math.min(...b[1].map(o => o.slotStart)))
  const tours: PlannedTour[] = []
  let freeAt = p.earliestMs ?? 0
  for (const [slot, list] of slots) {
    const slotStart = Math.min(...list.map(o => o.slotStart))
    // 1. séquence géographique globale : secteurs triés par proximité du hub, NN à l'intérieur de chaque secteur en enchaînant
    const groups = new Map<string, RouteOrder[]>()
    for (const o of list) { const k = o.sector ?? ''; (groups.get(k) ?? groups.set(k, []).get(k)!).push(o) }
    const centroid = (g: RouteOrder[]): Pt | null => { const ps = g.map(toPt).filter((x): x is Pt => !!x); return ps.length ? { lat: ps.reduce((s, x) => s + x.lat, 0) / ps.length, lng: ps.reduce((s, x) => s + x.lng, 0) / ps.length } : null }
    const ordered = [...groups.entries()].map(([k, g]) => ({ k, g, c: centroid(g) }))
      .sort((a, b) => (start && a.c && b.c ? dist(start, a.c) - dist(start, b.c) : 0) || a.k.localeCompare(b.k))
    const seq: RouteOrder[] = []
    let cur = start
    for (const { g } of ordered) {
      const withPt = g.filter(o => toPt(o)), noPt = g.filter(o => !toPt(o))
      const nn = nearestNeighbour(cur, withPt.map(o => toPt(o) as Pt))
      for (const i of nn) seq.push(withPt[i])
      seq.push(...noPt)
      const last = seq[seq.length - 1]; if (last && toPt(last)) cur = toPt(last)
    }
    // 2. découpage en rotations (capacité) — équilibré pour éviter une dernière rotation d'un seul stop
    const k = Math.max(1, Math.ceil(seq.length / p.maxStops))
    const sizes = Array.from({ length: k }, (_, i) => Math.floor(seq.length / k) + (i < seq.length % k ? 1 : 0))
    let off = 0
    sizes.forEach((sz, r) => {
      const chunk = seq.slice(off, off + sz); off += sz
      const departAt = Math.max(slotStart - p.loadMin * 60_000, freeAt, p.earliestMs ?? 0)
      const idx = sequenceStops(start, chunk, departAt, travel, p.serviceMin)
      const ord = idx.map(i => chunk[i])
      const arrivals = computeArrivals(start, departAt, ord.map(o => ({ pt: toPt(o), serviceMin: p.serviceMin })), travel)
      const pts = ord.map(toPt).filter((x): x is Pt => !!x)
      const lastPt = pts[pts.length - 1] ?? null
      const returnAt = (arrivals[arrivals.length - 1] ?? departAt) + p.serviceMin * 60_000 + (lastPt && start ? travel(lastPt, start, arrivals[arrivals.length - 1] ?? departAt) * 60_000 : 0)
      freeAt = returnAt + p.loadMin * 60_000
      tours.push({
        slot, rotationInSlot: r + 1, departAt, orderIds: ord.map(o => o.id), arrivals, lateIds: lateIdsOf(ord, arrivals),
        overflow: r + 1 > p.rotationsPerSlot, distanceM: pathLengthM(start, pts, pts.map((_, i) => i)), returnAt: Math.round(returnAt),
      })
    })
  }
  return tours
}
