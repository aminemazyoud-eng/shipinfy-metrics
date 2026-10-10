import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { envUnavailable } from '@/lib/env'
import { xlsxResponse } from '@/lib/xlsx-response'
import { dayStartUtc, addDays, localDay } from '@/lib/tz'
import { sensorSecret } from '@/lib/api-keys'
import {
  getThresholds, setThresholds, validateThresholds, detectBreaches, coldOrdersForBreach, stateOf, ingestReadings, evaluateColdChain, normPlate, type Reading,
} from '@/lib/ops-cold-chain'

export const runtime = 'nodejs'
const MAX_POINTS = 3000

function parseTime(v: string | null, edge: 'from' | 'to', fallback: number): number {
  if (!v) return fallback
  if (/^\d{4}-\d\d-\d\d$/.test(v)) return edge === 'from' ? dayStartUtc(v) : dayStartUtc(addDays(v, 1))
  const t = Date.parse(v)
  return Number.isNaN(t) ? fallback : t
}
const csvLine = (r: (string | number)[]) => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')
const fr = (n: number) => String(n).replace('.', ',')
const local = (ms: number) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' })

// GET /api/ops/cold-chain?vehicle=&from=&to=&format=xlsx&what=readings|breaches (MANAGER)
// Sans `vehicle` : liste des véhicules ayant des lectures sur 7 jours + état courant. Avec `vehicle` : lectures, ruptures, commandes froides concernées, tournées.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const now = Date.now()
    const th = await getThresholds()
    const canEdit = ['ADMIN', 'SUPER_ADMIN'].includes(auth.session.role)
    const vehicle = (sp.get('vehicle') ?? '').trim().toUpperCase().slice(0, 32)

    if (!vehicle) {
      const since = new Date(now - 7 * 86_400_000)
      const last = await prisma.$queryRaw<{ vehicleRef: string; celsius: number; at: Date; n: bigint }[]>`
        SELECT DISTINCT ON ("vehicleRef") "vehicleRef", "celsius", "at",
          (SELECT COUNT(*) FROM "OpsTempReading" c WHERE c."vehicleRef" = r."vehicleRef" AND c."at" >= ${since}) AS n
        FROM "OpsTempReading" r WHERE "at" >= ${since} ORDER BY "vehicleRef", "at" DESC`
      const recent = await prisma.opsTempReading.findMany({ where: { at: { gte: new Date(now - 6 * 3_600_000) } }, select: { vehicleRef: true, sensor: true, celsius: true, at: true }, take: 20_000 })
      const open = new Map<string, number>()
      for (const b of detectBreaches(recent, th)) if (b.level > 0 && b.ongoing) open.set(b.vehicleRef, (open.get(b.vehicleRef) ?? 0) + 1)
      return NextResponse.json({
        thresholds: th, canEdit,
        vehicles: last.map(l => ({ vehicleRef: l.vehicleRef, lastCelsius: l.celsius, lastAt: l.at, readings7d: Number(l.n), state: stateOf(l.celsius, l.at, th, now), openBreaches: open.get(l.vehicleRef) ?? 0 }))
          .sort((a, b) => (b.openBreaches - a.openBreaches) || a.vehicleRef.localeCompare(b.vehicleRef)),
      })
    }

    const to = parseTime(sp.get('to'), 'to', now)
    const from = parseTime(sp.get('from'), 'from', to - 24 * 3_600_000)
    if (to - from > 31 * 86_400_000) return NextResponse.json({ error: 'Période limitée à 31 jours' }, { status: 400 })
    const rows = await prisma.opsTempReading.findMany({ where: { vehicleRef: vehicle, at: { gte: new Date(from), lte: new Date(to) } }, orderBy: { at: 'asc' }, take: 50_000, select: { sensor: true, celsius: true, at: true, lat: true, lng: true } })
    const breaches = detectBreaches(rows.map(r => ({ vehicleRef: vehicle, ...r })), th).filter(b => b.level > 0)
    const withOrders = await Promise.all(breaches.slice(0, 30).map(async b => ({ ...b, orders: await coldOrdersForBreach(vehicle, b.startMs, b.endMs) })))

    if (sp.get('format') === 'xlsx') {
      const what = sp.get('what') === 'breaches' ? 'breaches' : 'readings'
      const head = what === 'readings' ? ['Véhicule', 'Capteur', 'Date', '°C', 'Latitude', 'Longitude', 'Hors seuil'] : ['Véhicule', 'Capteur', 'Début', 'Fin', 'Durée (min)', 'Extrême °C', 'Sens', 'Niveau', 'En cours', 'Commandes froides']
      const lines = what === 'readings'
        ? rows.map(r => [vehicle, r.sensor ?? 'main', local(r.at.getTime()), fr(r.celsius), r.lat ?? '', r.lng ?? '', r.celsius > th.max || r.celsius < th.min ? 'oui' : 'non'])
        : withOrders.map(b => [vehicle, b.sensor, local(b.startMs), local(b.endMs), fr(Math.round(b.durationMin)), fr(b.peak), b.kind === 'HIGH' ? 'trop chaud' : 'trop froid', b.level, b.ongoing ? 'oui' : 'non', b.orders.map(o => o.reference || o.externalId).join(' ')])
      return xlsxResponse('﻿' + [head, ...lines].map(csvLine).join('\r\n'), `froid-${normPlate(vehicle)}-${localDay(from)}`, what === 'readings' ? 'Lectures' : 'Ruptures')
    }

    // allègement pour la courbe : échantillonnage régulier au-delà de MAX_POINTS
    const step = Math.max(1, Math.ceil(rows.length / MAX_POINTS))
    const points = rows.filter((_, i) => i % step === 0 || i === rows.length - 1).map(r => ({ sensor: r.sensor ?? 'main', celsius: r.celsius, at: r.at }))
    const days = [...new Set([localDay(from), localDay(to)])]
    const tours = (await prisma.opsTour.findMany({ where: { day: { in: days } }, select: { id: true, day: true, rotation: true, driverCode: true, status: true, vehicleRef: true } }))
      .filter(t => t.vehicleRef && normPlate(t.vehicleRef) === normPlate(vehicle))
      .map(t => ({ id: t.id, day: t.day, rotation: t.rotation, driverCode: t.driverCode, status: t.status }))
    return NextResponse.json({ thresholds: th, canEdit, vehicle, from, to, count: rows.length, sampled: step > 1, readings: points, breaches: withOrders, tours, last: rows.length ? rows[rows.length - 1] : null })
  } catch (e) { return fail(e) }
}

// POST /api/ops/cold-chain (ADMIN)
//  { action:'thresholds', min, max, graceMin }
//  { action:'inject', vehicleRef, scenario:'ok'|'breach' } ou { action:'inject', vehicleRef, readings:[{celsius, minutesAgo}] }  — MODE TEST (capteur « test »)
//  { action:'purge-test' }  — supprime les lectures du capteur « test »
//  { action:'sensor-secret', sensorId } — secret HMAC dérivé du capteur (à configurer sur la passerelle)
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as Record<string, unknown>
    if (b.action === 'thresholds') {
      const t = { min: Number(b.min), max: Number(b.max), graceMin: Number(b.graceMin) }
      const err = validateThresholds(t)
      if (err) return NextResponse.json({ error: err }, { status: 400 })
      await setThresholds(t)
      await audit(auth.session, 'cold.thresholds', 'config', null, t)
      return NextResponse.json({ ok: true, thresholds: t })
    }
    if (b.action === 'inject') {
      const vehicleRef = typeof b.vehicleRef === 'string' ? b.vehicleRef.trim().toUpperCase().slice(0, 32) : ''
      if (!vehicleRef) return NextResponse.json({ error: 'vehicleRef requis' }, { status: 400 })
      const th = await getThresholds()
      const now = Date.now()
      let pts: { celsius: number; minutesAgo: number }[]
      if (Array.isArray(b.readings)) {
        pts = b.readings.slice(0, 200).map(r => ({ celsius: Number((r as { celsius?: unknown }).celsius), minutesAgo: Number((r as { minutesAgo?: unknown }).minutesAgo ?? 0) }))
        if (pts.some(p => !Number.isFinite(p.celsius) || p.celsius < -60 || p.celsius > 100 || !Number.isFinite(p.minutesAgo) || p.minutesAgo < 0 || p.minutesAgo > 7 * 1440)) return NextResponse.json({ error: 'celsius (-60..100) et minutesAgo (0..10080) requis' }, { status: 400 })
      } else if (b.scenario === 'ok' || b.scenario === 'breach') {
        const mid = (th.min + th.max) / 2, hot = th.max + 3.2
        const brokenN = Math.ceil((th.graceMin * 1.2) / 5) + 1 // nombre de points consécutifs hors seuil (1 point / 5 min), assez pour dépasser la tolérance
        const total = brokenN + 8
        pts = Array.from({ length: total }, (_, i) => {
          const age = total - 1 - i // 0 = le plus récent
          const broken = b.scenario === 'breach' && age < brokenN
          return { minutesAgo: age * 5, celsius: Math.round((broken ? hot + (i % 3) * 0.2 : mid + ((i % 4) - 1.5) * 0.3) * 10) / 10 }
        })
      } else return NextResponse.json({ error: 'scenario (ok | breach) ou readings requis' }, { status: 400 })
      const readings: Reading[] = pts.map(p => ({ vehicleRef, sensor: 'test', celsius: p.celsius, at: new Date(now - p.minutesAgo * 60_000), lat: null, lng: null }))
      const res = await ingestReadings(readings)
      const ev = await evaluateColdChain([vehicleRef])
      await audit(auth.session, 'cold.inject', 'cold_chain', vehicleRef, { scenario: b.scenario ?? 'manual', count: readings.length })
      return NextResponse.json({ ok: true, ...res, evaluation: ev })
    }
    if (b.action === 'purge-test') {
      const n = (await prisma.opsTempReading.deleteMany({ where: { sensor: 'test' } })).count
      await audit(auth.session, 'cold.purge_test', 'cold_chain', null, { deleted: n })
      return NextResponse.json({ ok: true, deleted: n })
    }
    if (b.action === 'sensor-secret') {
      const id = typeof b.sensorId === 'string' ? b.sensorId.trim() : ''
      if (!/^[\w.:-]{1,40}$/.test(id)) return NextResponse.json({ error: 'sensorId invalide' }, { status: 400 })
      await audit(auth.session, 'cold.sensor_secret', 'cold_chain', id)
      return NextResponse.json({ sensorId: id, secret: sensorSecret(id) })
    }
    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  } catch (e) { const env = envUnavailable(e); return env ?? fail(e) }
}
