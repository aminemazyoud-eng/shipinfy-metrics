/**
 * lib/api-guard.ts — garde d'authentification des routes /api/** (Sprint 17 A1).
 * Le proxy (Edge) ne teste que la PRÉSENCE d'un cookie : la vraie garde est ici, dans chaque route.
 *   const a = await requireSession(req, 'MANAGER'); if ('error' in a) return a.error
 * Les tâches planifiées internes peuvent s'authentifier par l'en-tête `x-cron-secret` (variable CRON_SECRET).
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getSession, roleAtLeast, type Role, type SessionPayload } from '@/lib/auth'

export function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET, got = req.headers.get('x-cron-secret')
  if (!secret || !got) return false
  const a = Buffer.from(secret), b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function requireSession(req: NextRequest | Request, min?: Role, opts: { allowCron?: boolean } = {}): Promise<{ session: SessionPayload } | { error: NextResponse }> {
  if (opts.allowCron && isCron(req)) return { session: { userId: 'cron', tenantId: null, role: 'SUPER_ADMIN', name: 'Cron interne', email: 'cron@local' } }
  const session = await getSession(req)
  if (!session) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  if (min && !roleAtLeast(session.role, min)) return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  return { session }
}
