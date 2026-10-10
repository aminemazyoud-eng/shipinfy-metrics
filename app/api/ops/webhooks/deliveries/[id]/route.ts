import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { envUnavailable } from '@/lib/env'
import { replayDelivery, processDeliveries } from '@/lib/ops-webhooks'

export const runtime = 'nodejs'

// POST /api/ops/webhooks/deliveries/:id — rejeu manuel (ADMIN). Le dernier état de la livraison est renvoyé.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    if (!(await replayDelivery(id))) return NextResponse.json({ error: 'Livraison introuvable' }, { status: 404 })
    await processDeliveries({ id })
    const d = await prisma.opsWebhookDelivery.findUnique({ where: { id }, select: { status: true, attempts: true, lastError: true } })
    await audit(auth.session, 'webhook.replay', 'webhook_delivery', id, { status: d?.status })
    return NextResponse.json({ ok: true, delivery: d })
  } catch (e) { const env = envUnavailable(e); return env ?? fail(e) }
}
