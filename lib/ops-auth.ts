/**
 * lib/ops-auth.ts — garde d'accès + journal d'audit des routes /api/ops/*
 * Dev uniquement : OPS_DEV_NOAUTH=1 (ou OPS_DIRECT=1) contourne la session — ignoré en production.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession, roleAtLeast, type Role, type SessionPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { applyOpsSettings } from '@/lib/ops-settings'

const devBypass = () => process.env.NODE_ENV !== 'production' && (process.env.OPS_DEV_NOAUTH === '1' || process.env.OPS_DIRECT === '1')

export async function opsAuth(req: NextRequest, min?: Role): Promise<{ session: SessionPayload } | { error: NextResponse }> {
  await applyOpsSettings()
  if (devBypass()) return { session: { userId: 'dev', tenantId: null, role: 'SUPER_ADMIN', name: 'Dev local', email: 'dev@local' } }
  const session = await getSession(req)
  if (!session) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  if (min && !roleAtLeast(session.role, min)) return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  return { session }
}

export function fail(e: unknown, status = 500) {
  console.error('[api/ops]', e)
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur serveur' }, { status })
}

/** Trace une action (qui, quoi, quand) — alimente l'historique consulting. N'échoue jamais. */
export async function audit(session: SessionPayload, action: string, entity: string, entityId: string | null, payload?: unknown, hubCode?: string | null) {
  try {
    await prisma.opsAuditLog.create({
      data: { actor: session.name || session.email, action, entity, entityId, hubCode: hubCode ?? null, payload: payload === undefined ? null : JSON.stringify(payload), tenantId: session.tenantId },
    })
  } catch (e) { console.warn('[audit]', e) }
}
