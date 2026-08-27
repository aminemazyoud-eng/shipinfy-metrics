import { NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { applyN8nResult, type NotifyChannel } from '@/lib/notify'

export const runtime = 'nodejs'

const WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET

// POST /api/webhooks/n8n — N8N calls back into Shipinfy
// Use this as the "response webhook" URL in your N8N workflows.
//
// Sprint 17 — per-channel delivery result:
//   { notificationId: "clx...", channel: "email"|"slack"|"whatsapp",
//     status: "delivered"|"failed", sentTo?: "...", error?: "..." }
//
// Legacy payloads (action-based) are still accepted and just logged.
export async function POST(req: Request) {
  try {
    let payload: Record<string, unknown>

    if (WEBHOOK_SECRET) {
      const sig  = req.headers.get('X-N8N-Signature') ?? ''
      const body = await req.text()
      const expected = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`
      if (sig !== expected) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
      payload = JSON.parse(body) as Record<string, unknown>
    } else {
      payload = await req.json() as Record<string, unknown>
    }

    return handleCallback(payload)
  } catch (e) {
    console.error('[webhooks/n8n]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

const VALID_CHANNELS: NotifyChannel[] = ['email', 'slack', 'whatsapp']

async function handleCallback(payload: Record<string, unknown>) {
  const notificationId = typeof payload.notificationId === 'string' ? payload.notificationId : null
  const channel        = typeof payload.channel === 'string' ? payload.channel as NotifyChannel : null
  const rawStatus      = typeof payload.status === 'string' ? payload.status : null

  if (notificationId && channel && VALID_CHANNELS.includes(channel)) {
    const status: 'delivered' | 'failed' =
      rawStatus === 'delivered' || rawStatus === 'success' || rawStatus === 'ok' ? 'delivered' : 'failed'

    await applyN8nResult(notificationId, channel, status, {
      sentTo: typeof payload.sentTo === 'string' ? payload.sentTo : undefined,
      error:  typeof payload.error === 'string' ? payload.error : undefined,
    })

    return NextResponse.json({ received: true, notificationId, channel, status })
  }

  // Legacy / unstructured callback — just log
  console.log('[N8N Callback]', JSON.stringify(payload).slice(0, 1000))
  return NextResponse.json({ received: true, timestamp: new Date().toISOString() })
}
