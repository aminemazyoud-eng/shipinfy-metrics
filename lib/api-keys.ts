/**
 * lib/api-keys.ts — authentification des SYSTÈMES EXTERNES (API entrante /api/v1, récepteur IoT /api/iot).
 * Les clés vivent dans une variable d'environnement (pas de schéma) : INGEST_API_KEYS (commandes) et IOT_API_KEYS (capteurs),
 * liste séparée par des virgules, chaque entrée « clé » ou « nom:clé » (clé ≥ 16 caractères). Elles ne sont JAMAIS comparées en clair :
 * on hache (SHA-256) la clé reçue et chaque clé configurée à la volée, puis on compare avec timingSafeEqual.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { requireEnv } from '@/lib/env'
import { clientIp } from '@/lib/rate-limit'

export const hashKey = (k: string): Buffer => createHash('sha256').update(k, 'utf8').digest()

export interface KeyEntry { name: string; hash: Buffer }

/** Lit et hache les clés de la variable d'environnement (évalué à l'usage : MissingEnvError → 503 côté route). */
export function loadKeys(envName: 'INGEST_API_KEYS' | 'IOT_API_KEYS'): KeyEntry[] {
  const raw = requireEnv(envName)
  const out: KeyEntry[] = []
  raw.split(',').map(s => s.trim()).filter(Boolean).forEach((entry, i) => {
    const idx = entry.indexOf(':')
    const name = idx > 0 && idx < entry.length - 1 ? entry.slice(0, idx).trim() : `cle${i + 1}`
    const key = idx > 0 && idx < entry.length - 1 ? entry.slice(idx + 1).trim() : entry
    if (key.length >= 16) out.push({ name: name.slice(0, 40).replace(/[^\w.-]/g, '_') || `cle${i + 1}`, hash: hashKey(key) })
  })
  return out
}

/**
 * Vérifie l'en-tête x-api-key. Renvoie le nom de la clé (traçabilité) ou null.
 * Comparaison à temps constant sur les empreintes SHA-256 (toutes les clés sont parcourues, pas de court-circuit).
 */
export function verifyApiKey(req: Request, envName: 'INGEST_API_KEYS' | 'IOT_API_KEYS' = 'INGEST_API_KEYS'): string | null {
  const given = req.headers.get('x-api-key')
  if (!given || given.length > 200) return null
  const h = hashKey(given)
  let found: string | null = null
  for (const k of loadKeys(envName)) if (timingSafeEqual(h, k.hash) && !found) found = k.name
  return found
}

/** Garde de base : limite par IP des tentatives (échecs d'authentification) — renvoie une réponse 429/401 ou le nom de la clé. */
export function guardApiKey(req: Request, envName: 'INGEST_API_KEYS' | 'IOT_API_KEYS' = 'INGEST_API_KEYS'): { name: string } | { error: NextResponse } {
  const ip = clientIp(req)
  // force brute : 30 échecs / 10 min / IP
  if (!rateLimitPeek(`apikey-fail|${envName}|${ip}`)) return { error: NextResponse.json({ error: 'Trop de tentatives' }, { status: 429, headers: { 'Retry-After': '600' } }) }
  const name = verifyApiKey(req, envName)
  if (!name) { noteApiKeyFailure(envName, req); return { error: NextResponse.json({ error: 'Clé API invalide ou absente' }, { status: 401 }) } }
  return { name }
}

// lecture sans incrément : le compteur n'est incrémenté que sur un échec (rateLimit ajoute un hit à chaque appel)
const fails = new Map<string, number[]>()
function rateLimitPeek(key: string): boolean {
  const now = Date.now()
  const arr = (fails.get(key) ?? []).filter(t => now - t < 600_000)
  fails.set(key, arr)
  return arr.length < 30
}
export function noteApiKeyFailure(envName: string, req: Request) {
  const key = `apikey-fail|${envName}|${clientIp(req)}`
  const arr = fails.get(key) ?? []; arr.push(Date.now()); fails.set(key, arr)
}

/** Secret HMAC propre à un capteur : dérivé du secret serveur IOT_HMAC_SECRET (rien à stocker, révocable en changeant le secret). */
export const sensorSecret = (sensorId: string): string =>
  createHmac('sha256', requireEnv('IOT_HMAC_SECRET')).update(`sensor:${sensorId}`).digest('hex')

/** Vérifie une signature HMAC-SHA256 hex de `${timestamp}.${corps}` avec fenêtre ±5 min (anti-rejeu). */
export function verifyHmac(secret: string, ts: string, body: string, sig: string, windowMs = 5 * 60_000): boolean {
  const n = Number(ts)
  if (!ts || !Number.isFinite(n)) return false
  const ms = n < 1e11 ? n * 1000 : n
  if (Math.abs(Date.now() - ms) > windowMs) return false
  const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  const a = Buffer.from(sig.replace(/^sha256=/i, '')), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
