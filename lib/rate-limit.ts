/**
 * lib/rate-limit.ts — limiteur à fenêtre glissante, EN MÉMOIRE (Sprint 17 A8).
 * Suffisant tant qu'il n'y a qu'un conteneur ; en multi-réplica, remplacer par Redis ou un middleware Traefik `rateLimit`.
 */
import { NextRequest, NextResponse } from 'next/server'

const hits = new Map<string, number[]>()
let lastSweep = 0

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  if (now - lastSweep > 60_000) { lastSweep = now; for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 3_600_000) hits.delete(k) }
  const arr = (hits.get(key) ?? []).filter(t => now - t < windowMs)
  arr.push(now); hits.set(key, arr)
  return arr.length <= max
}

/** IP du client derrière Traefik (dernier saut de confiance = dernière valeur de x-forwarded-for). */
export function clientIp(req: NextRequest | Request): string {
  const xff = req.headers.get('x-forwarded-for')
  return (xff ? xff.split(',').pop()!.trim() : req.headers.get('x-real-ip')) || 'unknown'
}

/** Renvoie une réponse 429 si la limite est dépassée, sinon null. */
export function limited(req: NextRequest | Request, bucket: string, max: number, windowMs: number, extra = ''): NextResponse | null {
  return rateLimit(`${bucket}|${clientIp(req)}|${extra}`, max, windowMs)
    ? null
    : NextResponse.json({ error: 'Trop de requêtes — réessayez plus tard' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(windowMs / 1000)) } })
}
