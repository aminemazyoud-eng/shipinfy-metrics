import { NextRequest, NextResponse } from 'next/server'
import { guardApiKey, sensorSecret, verifyHmac, noteApiKeyFailure } from '@/lib/api-keys' // garde : verifyApiKey (SHA-256 + timingSafeEqual) OU HMAC par capteur — route publique pour proxy.ts
import { envUnavailable } from '@/lib/env'
import { limited } from '@/lib/rate-limit'
import { validateReadings, ingestReadings, evaluateColdChain, MAX_BATCH } from '@/lib/ops-cold-chain'

export const runtime = 'nodejs'
const MAX_BODY = 256 * 1024

// POST /api/iot/temperature — récepteur de lectures de température (passerelle / capteur).
// Corps : { "readings": [ { "vehicleRef": "12345-A-6", "sensor": "frigo", "celsius": 4.2, "at": "2026-10-10T09:30:00Z", "lat": 33.57, "lng": -7.58 } ] }  (≤ 500 lectures)
// Authentification (une des deux) :
//   1. x-api-key : clé de IOT_API_KEYS ;
//   2. HMAC par capteur : x-sensor-id, x-timestamp (s ou ms, ±5 min), x-signature = HMAC-SHA256 hex de « timestamp.corps » avec le secret dérivé du capteur
//      (HMAC(IOT_HMAC_SECRET, "sensor:<id>")) ; toutes les lectures doivent alors porter ce capteur.
// Idempotent par (vehicleRef, sensor, at) : un renvoi ne duplique rien.
export async function POST(req: NextRequest) {
  const lim = limited(req, 'iot-ip', 300, 60_000)
  if (lim) return lim
  try {
    const len = Number(req.headers.get('content-length') ?? 0)
    if (len > MAX_BODY) return NextResponse.json({ error: 'Corps trop volumineux' }, { status: 413 })
    const raw = await req.text()
    if (raw.length > MAX_BODY) return NextResponse.json({ error: 'Corps trop volumineux' }, { status: 413 })

    let who = ''
    let forcedSensor: string | null = null
    if (req.headers.get('x-api-key')) {
      const g = guardApiKey(req, 'IOT_API_KEYS')
      if ('error' in g) return g.error
      who = g.name
    } else if (req.headers.get('x-signature')) {
      const sensorId = (req.headers.get('x-sensor-id') ?? '').trim()
      const ok = /^[\w.:-]{1,40}$/.test(sensorId) && verifyHmac(sensorSecret(sensorId), req.headers.get('x-timestamp') ?? '', raw, req.headers.get('x-signature') ?? '')
      if (!ok) { noteApiKeyFailure('IOT_HMAC', req); return NextResponse.json({ error: 'Signature invalide' }, { status: 401 }) }
      who = `sensor:${sensorId}`; forcedSensor = sensorId
    } else return NextResponse.json({ error: 'Authentification requise (x-api-key ou signature HMAC)' }, { status: 401 })

    const lim2 = limited(req, 'iot-key', 120, 60_000, who)
    if (lim2) return lim2

    let json: unknown
    try { json = JSON.parse(raw) } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }
    const list = Array.isArray(json) ? json : (json as { readings?: unknown })?.readings
    const withSensor = forcedSensor && Array.isArray(list) ? list.map(r => ({ ...(r as object), sensor: (r as { sensor?: unknown })?.sensor ?? forcedSensor })) : list
    const { readings, errors } = validateReadings(withSensor)
    if (forcedSensor && readings.some(r => r.sensor !== forcedSensor)) return NextResponse.json({ error: 'Une lecture porte un autre capteur que celui signé' }, { status: 403 })
    if (!readings.length) return NextResponse.json({ error: 'Aucune lecture valide', details: errors, max: MAX_BATCH }, { status: 422 })
    const res = await ingestReadings(readings)
    void evaluateColdChain(res.vehicles) // détection immédiate, sans bloquer la réponse
    return NextResponse.json({ accepted: res.accepted, duplicates: res.duplicates, rejected: errors.length, ...(errors.length ? { details: errors } : {}) }, { status: 202 })
  } catch (e) {
    const env = envUnavailable(e); if (env) return env
    console.error('[api/iot/temperature]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
