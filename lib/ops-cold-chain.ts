/**
 * lib/ops-cold-chain.ts — TEMPÉRATURE / CHAÎNE DU FROID.
 * Honnêteté : sans capteur réel branché (POST /api/iot/temperature), seul le RÉCEPTEUR existe ; la page /operations/froid permet
 * d'injecter des lectures de test (admin) pour valider seuils, alertes et rattachement aux commandes.
 *
 * Seuils (OpsCostParam) : 'cold.min' (défaut +2 °C), 'cold.max' (défaut +6 °C), 'cold.graceMin' (tolérance, défaut 15 min).
 * Rupture = suite CONSÉCUTIVE de lectures hors [min, max] d'un même capteur dont la durée dépasse la tolérance. Durée = du 1er relevé hors seuil
 * jusqu'au 1er relevé revenu dans la plage (rupture close) ou jusqu'au dernier relevé (rupture en cours). Les ruptures sont DÉRIVÉES des lectures
 * (aucune table dédiée) ; l'alerte (DeliveryAlert 'cold_chain', niveau 2 puis 3) est dédoublonnée par rupture dans lib/alert-engine.ts.
 * Mappage commandes : lignes OpsOrderItem.coldChain = true des commandes des tournées du véhicule (OpsTour.vehicleRef → OpsStop / OpsOrder.tourId).
 */
import { prisma } from '@/lib/prisma'
import { localDay, localParts } from '@/lib/tz'

export interface Thresholds { min: number; max: number; graceMin: number }
export const DEFAULT_THRESHOLDS: Thresholds = { min: 2, max: 6, graceMin: 15 }
export const MAX_BATCH = 500
export const MAX_AGE_MS = 7 * 86_400_000

export const normPlate = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

export async function getThresholds(): Promise<Thresholds> {
  const rows = await prisma.opsCostParam.findMany({ where: { key: { in: ['cold.min', 'cold.max', 'cold.graceMin'] } } })
  const m = new Map(rows.map(r => [r.key, r.value]))
  return { min: m.get('cold.min') ?? DEFAULT_THRESHOLDS.min, max: m.get('cold.max') ?? DEFAULT_THRESHOLDS.max, graceMin: m.get('cold.graceMin') ?? DEFAULT_THRESHOLDS.graceMin }
}

export function validateThresholds(t: Partial<Thresholds>): string | null {
  const { min, max, graceMin } = t
  if ([min, max, graceMin].some(v => typeof v !== 'number' || !Number.isFinite(v))) return 'min, max et graceMin doivent être des nombres'
  if (min! < -40 || max! > 40 || min! >= max!) return 'plage invalide : -40 <= min < max <= 40'
  if (graceMin! < 0 || graceMin! > 240) return 'tolérance : 0 à 240 minutes'
  return null
}

export async function setThresholds(t: Thresholds) {
  const note: Record<string, string> = { 'cold.min': 'Chaîne du froid : seuil bas (°C)', 'cold.max': 'Chaîne du froid : seuil haut (°C)', 'cold.graceMin': 'Chaîne du froid : tolérance avant rupture (min)' }
  const vals: Record<string, number> = { 'cold.min': t.min, 'cold.max': t.max, 'cold.graceMin': t.graceMin }
  for (const key of Object.keys(vals)) await prisma.opsCostParam.upsert({ where: { key }, update: { value: vals[key] }, create: { key, value: vals[key], note: note[key] } })
}

// ── ingestion ────────────────────────────────────────────────────────────────
export interface RawReading { vehicleRef?: unknown; sensor?: unknown; celsius?: unknown; at?: unknown; lat?: unknown; lng?: unknown }
export interface Reading { vehicleRef: string; sensor: string; celsius: number; at: Date; lat: number | null; lng: number | null }

export function validateReadings(list: unknown): { readings: Reading[]; errors: string[] } {
  const errors: string[] = [], readings: Reading[] = []
  if (!Array.isArray(list) || !list.length) return { readings, errors: ['readings : tableau non vide attendu'] }
  if (list.length > MAX_BATCH) return { readings, errors: [`readings : ${MAX_BATCH} lectures maximum par requête`] }
  const now = Date.now()
  list.forEach((r, i) => {
    const x = (r ?? {}) as RawReading
    const vehicle = typeof x.vehicleRef === 'string' ? x.vehicleRef.trim().toUpperCase() : ''
    const sensor = x.sensor == null || x.sensor === '' ? 'main' : typeof x.sensor === 'string' ? x.sensor.trim() : ''
    const c = typeof x.celsius === 'number' ? x.celsius : NaN
    const at = typeof x.at === 'string' || typeof x.at === 'number' ? new Date(x.at) : new Date(NaN)
    if (!vehicle || vehicle.length > 32) return void errors.push(`[${i}] vehicleRef requis (≤ 32 car.)`)
    if (!sensor || sensor.length > 40) return void errors.push(`[${i}] sensor invalide (≤ 40 car.)`)
    if (!Number.isFinite(c) || c < -60 || c > 100) return void errors.push(`[${i}] celsius hors de -60..100`)
    if (Number.isNaN(at.getTime()) || at.getTime() < now - MAX_AGE_MS || at.getTime() > now + 5 * 60_000) return void errors.push(`[${i}] at invalide (ISO 8601, entre J-7 et maintenant)`)
    const lat = x.lat == null ? null : typeof x.lat === 'number' && Math.abs(x.lat) <= 90 ? x.lat : NaN
    const lng = x.lng == null ? null : typeof x.lng === 'number' && Math.abs(x.lng) <= 180 ? x.lng : NaN
    if ((lat != null && Number.isNaN(lat)) || (lng != null && Number.isNaN(lng))) return void errors.push(`[${i}] lat/lng invalides`)
    readings.push({ vehicleRef: vehicle, sensor, celsius: Math.round(c * 100) / 100, at, lat, lng })
  })
  return { readings, errors: errors.slice(0, 20) }
}

/** Insère les lectures nouvelles ; idempotent par (vehicleRef, sensor, at) — verrou consultatif par véhicule (pas de contrainte unique au schéma). */
export async function ingestReadings(readings: Reading[]): Promise<{ accepted: number; duplicates: number; vehicles: string[] }> {
  const byVehicle = new Map<string, Reading[]>()
  for (const r of readings) (byVehicle.get(r.vehicleRef) ?? byVehicle.set(r.vehicleRef, []).get(r.vehicleRef)!).push(r)
  let accepted = 0, duplicates = 0
  for (const [vehicleRef, list] of byVehicle) {
    const fresh = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cold:' + vehicleRef}))`
      const min = new Date(Math.min(...list.map(r => r.at.getTime()))), max = new Date(Math.max(...list.map(r => r.at.getTime())))
      const have = await tx.opsTempReading.findMany({ where: { vehicleRef, at: { gte: min, lte: max } }, select: { sensor: true, at: true } })
      const seen = new Set(have.map(h => `${h.sensor ?? 'main'}|${h.at.getTime()}`))
      const out: Reading[] = []
      for (const r of list) { const k = `${r.sensor}|${r.at.getTime()}`; if (seen.has(k)) continue; seen.add(k); out.push(r) }
      if (out.length) await tx.opsTempReading.createMany({ data: out.map(r => ({ vehicleRef: r.vehicleRef, sensor: r.sensor, celsius: r.celsius, at: r.at, lat: r.lat, lng: r.lng })) })
      return out.length
    })
    accepted += fresh; duplicates += list.length - fresh
  }
  return { accepted, duplicates, vehicles: [...byVehicle.keys()] }
}

// ── détection ────────────────────────────────────────────────────────────────
export interface Breach {
  vehicleRef: string; sensor: string; startMs: number; endMs: number; ongoing: boolean
  durationMin: number; peak: number; kind: 'HIGH' | 'LOW'; readings: number; level: 0 | 2 | 3 // 0 = hors seuil mais sous la tolérance
}

/** Fonction pure : ruptures d'un jeu de lectures (toutes dates, tous capteurs d'un même véhicule). */
export function detectBreaches(rows: { vehicleRef: string; sensor: string | null; celsius: number; at: Date }[], th: Thresholds): Breach[] {
  const bySensor = new Map<string, typeof rows>()
  for (const r of rows) { const k = `${r.vehicleRef}|${r.sensor ?? 'main'}`; (bySensor.get(k) ?? bySensor.set(k, []).get(k)!).push(r) }
  const out: Breach[] = []
  for (const list of bySensor.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime())
    const st: { cur: { start: number; last: number; n: number; high: number; low: number; maxC: number; minC: number } | null } = { cur: null }
    const close = (endMs: number, ongoing: boolean) => {
      const c = st.cur
      if (!c) return
      const kind: 'HIGH' | 'LOW' = c.high >= c.low ? 'HIGH' : 'LOW'
      const peak = kind === 'HIGH' ? c.maxC : c.minC
      const durationMin = Math.round((endMs - c.start) / 600) / 100
      const dev = kind === 'HIGH' ? c.maxC - th.max : th.min - c.minC
      const level: 0 | 2 | 3 = durationMin < th.graceMin ? 0 : durationMin >= 2 * th.graceMin || dev >= 5 ? 3 : 2
      out.push({ vehicleRef: list[0].vehicleRef, sensor: list[0].sensor ?? 'main', startMs: c.start, endMs, ongoing, durationMin, peak, kind, readings: c.n, level })
      st.cur = null
    }
    for (const r of list) {
      const t = r.at.getTime(), hi = r.celsius > th.max, lo = r.celsius < th.min
      if (hi || lo) {
        if (!st.cur) st.cur = { start: t, last: t, n: 0, high: 0, low: 0, maxC: -Infinity, minC: Infinity }
        const c = st.cur
        c.last = t; c.n++
        if (hi) { c.high++; c.maxC = Math.max(c.maxC, r.celsius) } else { c.low++; c.minC = Math.min(c.minC, r.celsius) }
      } else if (st.cur) close(t, false)
    }
    if (st.cur) close(st.cur.last, true)
  }
  return out.sort((a, b) => b.startMs - a.startMs)
}

export interface ColdOrder { id: string; reference: string | null; externalId: string; status: string }

/** Commandes à lignes froides embarquées dans les tournées du véhicule le jour de la rupture et pas encore livrées avant son début. */
export async function coldOrdersForBreach(vehicleRef: string, startMs: number, endMs: number): Promise<ColdOrder[]> {
  const plate = normPlate(vehicleRef)
  const vehicles = await prisma.opsVehicle.findMany({ select: { id: true, plate: true } })
  const ids = new Set<string>([plate])
  for (const v of vehicles) if (normPlate(v.plate) === plate) ids.add(normPlate(v.id))
  const days = [...new Set([localDay(startMs), localDay(endMs)])]
  const tours = (await prisma.opsTour.findMany({ where: { day: { in: days } }, select: { id: true, vehicleRef: true } })).filter(t => t.vehicleRef && ids.has(normPlate(t.vehicleRef)))
  if (!tours.length) return []
  const tourIds = tours.map(t => t.id)
  const [stops, direct] = await Promise.all([
    prisma.opsStop.findMany({ where: { tourId: { in: tourIds } }, select: { orderId: true } }),
    prisma.opsOrder.findMany({ where: { tourId: { in: tourIds } }, select: { id: true } }),
  ])
  const orderIds = [...new Set([...stops.map(s => s.orderId), ...direct.map(o => o.id)])]
  if (!orderIds.length) return []
  const cold = await prisma.opsOrderItem.findMany({ where: { orderId: { in: orderIds }, coldChain: true }, select: { orderId: true }, distinct: ['orderId'] })
  if (!cold.length) return []
  const orders = await prisma.opsOrder.findMany({
    where: { id: { in: cold.map(c => c.orderId) }, status: { not: 'CANCELLED' }, OR: [{ deliveredAt: null }, { deliveredAt: { gte: new Date(startMs) } }] },
    select: { id: true, reference: true, externalId: true, status: true }, orderBy: { slotStart: 'asc' }, take: 200,
  })
  return orders
}

const inFlight = new Set<string>()
const stamp = (ms: number) => { const p = localParts(ms); const [, m, d] = p.day.split('-'); return `${d}/${m} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` }

/** Évalue les ruptures récentes (6 h) et émet les alertes (dédoublonnées). Ne lève jamais. */
export async function evaluateColdChain(vehicleRefs?: string[]): Promise<{ vehicles: number; breaches: number; alerts: number }> {
  const out = { vehicles: 0, breaches: 0, alerts: 0 }
  try {
    const th = await getThresholds()
    const since = new Date(Date.now() - 6 * 3_600_000)
    const rows = await prisma.opsTempReading.findMany({
      where: { at: { gte: since }, ...(vehicleRefs?.length ? { vehicleRef: { in: vehicleRefs } } : {}) }, orderBy: { at: 'asc' }, take: 20_000,
      select: { vehicleRef: true, sensor: true, celsius: true, at: true },
    })
    const vehicles = new Set(rows.map(r => r.vehicleRef))
    out.vehicles = vehicles.size
    const { emitColdChainAlert } = await import('@/lib/alert-engine')
    for (const vref of vehicles) {
      const key = `cold-eval:${vref}`
      if (inFlight.has(key)) continue
      inFlight.add(key)
      try {
        const breaches = detectBreaches(rows.filter(r => r.vehicleRef === vref), th).filter(b => b.level > 0)
        out.breaches += breaches.length
        for (const b of breaches) {
          const orders = await coldOrdersForBreach(vref, b.startMs, b.endMs)
          const refs = orders.slice(0, 10).map(o => o.reference || o.externalId)
          const message = `Rupture chaîne du froid — véhicule ${vref} (capteur ${b.sensor}) depuis ${stamp(b.startMs)} : ${b.kind === 'HIGH' ? 'max' : 'min'} ${String(b.peak).replace('.', ',')} °C pendant ${Math.round(b.durationMin)} min${b.ongoing ? ' (en cours)' : ''}, seuils ${th.min}–${th.max} °C.`
            + (orders.length ? ` Commandes froides concernées (${orders.length}) : ${refs.join(', ')}${orders.length > refs.length ? ` (+${orders.length - refs.length})` : ''}.` : ' Aucune commande froide rattachée à ce véhicule.')
          if (await emitColdChainAlert({ key: `véhicule ${vref} (capteur ${b.sensor}) depuis ${stamp(b.startMs)}`, level: b.level as 2 | 3, message })) out.alerts++
        }
      } finally { inFlight.delete(key) }
    }
  } catch (e) { console.warn('[cold-chain] évaluation:', e instanceof Error ? e.message : e) }
  return out
}

/** Dernière lecture + état par véhicule (page Froid). */
export function stateOf(lastCelsius: number, lastAt: Date, th: Thresholds, nowMs = Date.now()): 'OK' | 'HORS_SEUIL' | 'SILENCE' {
  if (nowMs - lastAt.getTime() > 30 * 60_000) return 'SILENCE'
  return lastCelsius > th.max || lastCelsius < th.min ? 'HORS_SEUIL' : 'OK'
}
