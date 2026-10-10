import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { envUnavailable } from '@/lib/env'
import { queuePing, processDeliveries } from '@/lib/ops-webhooks'

export const runtime = 'nodejs'

// POST /api/ops/webhooks/:id/test (ADMIN) — envoie immédiatement un événement « ping » signé
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    if (!(await prisma.opsWebhookEndpoint.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: 'Endpoint introuvable' }, { status: 404 })
    const did = await queuePing(id)
    await processDeliveries({ id: did })
    const d = await prisma.opsWebhookDelivery.findUnique({ where: { id: did }, select: { status: true, attempts: true, lastError: true } })
    await audit(auth.session, 'webhook.test', 'webhook', id, { status: d?.status })
    return NextResponse.json({ ok: d?.status === 'OK', delivery: d })
  } catch (e) { const env = envUnavailable(e); return env ?? fail(e) }
}
