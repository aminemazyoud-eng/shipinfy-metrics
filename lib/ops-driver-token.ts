/**
 * lib/ops-driver-token.ts — jeton de l'application livreur (Sprint 20).
 * Format (en-tête `x-driver-token`) : base64url(driverCode).exp.sig
 *   - sig = HMAC-SHA256 hex de `drv|driverCode|tokenVersion|exp` avec PLANNING_LINK_SECRET (requireEnv : jamais de repli) ;
 *   - exp (ms epoch) = émission + 30 jours ;
 *   - tokenVersion est lu en base (OpsDriver.tokenVersion) : l'incrémenter révoque tous les liens déjà émis.
 * Les fonctions pures (make/read/verify) n'ont aucun accès base ; driverFromRequest fait le contrôle complet.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireEnv, envUnavailable } from '@/lib/env'

export const DRIVER_TOKEN_TTL_MS = 30 * 86_400_000
export const DRIVER_TOKEN_HEADER = 'x-driver-token'

const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const sigOf = (driverCode: string, tokenVersion: number, exp: number) =>
  createHmac('sha256', requireEnv('PLANNING_LINK_SECRET')).update(`drv|${driverCode}|${tokenVersion}|${exp}`).digest('hex')

/** Émet un jeton valable 30 jours pour ce livreur et cette version de jeton. */
export function makeDriverToken(driverCode: string, tokenVersion: number, nowMs = Date.now()): string {
  const exp = nowMs + DRIVER_TOKEN_TTL_MS
  return `${b64u(driverCode)}.${exp}.${sigOf(driverCode, tokenVersion, exp)}`
}

export interface DriverTokenClaims { driverCode: string; exp: number; sig: string }

/**
 * Lit la structure d'un jeton SANS vérifier la signature (elle dépend de tokenVersion, connue seulement en base).
 * Renvoie null si le format est invalide. À compléter par verifyDriverToken.
 */
export function readDriverToken(token: string | null | undefined): DriverTokenClaims | null {
  if (typeof token !== 'string' || token.length > 400) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [c, e, sig] = parts
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(c) || !/^\d{10,16}$/.test(e) || !/^[0-9a-f]{64}$/.test(sig)) return null
  const driverCode = Buffer.from(c, 'base64url').toString('utf8')
  if (!driverCode || driverCode.length > 60) return null
  return { driverCode, exp: Number(e), sig }
}

/** Vrai si le jeton est authentique pour cette version, non expiré. Comparaison à temps constant. */
export function verifyDriverToken(claims: DriverTokenClaims | null, tokenVersion: number, nowMs = Date.now()): boolean {
  if (!claims || !Number.isFinite(claims.exp) || nowMs > claims.exp) return false
  const a = Buffer.from(sigOf(claims.driverCode, tokenVersion, claims.exp)), b = Buffer.from(claims.sig)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Réponse JSON sans cache (aucune donnée livreur ne doit être mise en cache par un proxy ou le navigateur). */
export const driverJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const noStore = (r: NextResponse): NextResponse => { r.headers.set('Cache-Control', 'no-store'); return r }

/**
 * Authentifie une requête de l'application livreur. Renvoie le OpsDriver (avec hub et véhicule) ou une NextResponse :
 * 401 (jeton absent / altéré / expiré / révoqué), 403 (livreur désactivé), 429 (limite), 503 (secret non configuré).
 * Limiteur : 120 requêtes / minute par IP + livreur ; les jetons illisibles sont limités par IP seule.
 */
export async function driverFromRequest(req: NextRequest | Request) {
  try {
    const { limited } = await import('@/lib/rate-limit')
    const claims = readDriverToken(req.headers.get(DRIVER_TOKEN_HEADER))
    if (!claims) {
      const l = limited(req, 'driver-bad', 30, 60_000)
      return noStore(l ?? NextResponse.json({ error: 'Jeton absent ou invalide', code: 'TOKEN_INVALID' }, { status: 401 }))
    }
    const l = limited(req, 'driver', 120, 60_000, claims.driverCode)
    if (l) return noStore(l)
    const { prisma } = await import('@/lib/prisma')
    const driver = await prisma.opsDriver.findUnique({ where: { code: claims.driverCode }, include: { hub: true, vehicle: true } })
    // jeton inconnu / altéré / expiré / révoqué : même réponse (pas d'indice sur l'existence du livreur)
    if (!driver || !verifyDriverToken(claims, driver.tokenVersion)) return noStore(NextResponse.json({ error: 'Jeton invalide, expiré ou révoqué', code: 'TOKEN_INVALID' }, { status: 401 }))
    if (driver.status === 'off') return noStore(NextResponse.json({ error: 'Compte livreur désactivé', code: 'DRIVER_OFF' }, { status: 403 }))
    return driver
  } catch (e) {
    const env = envUnavailable(e)
    if (env) return noStore(env)
    console.error('[api/driver] auth', e)
    return noStore(NextResponse.json({ error: 'Erreur serveur' }, { status: 500 }))
  }
}

export type DriverRecord = Exclude<Awaited<ReturnType<typeof driverFromRequest>>, NextResponse>
