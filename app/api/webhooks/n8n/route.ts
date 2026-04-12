import { NextResponse } from 'next/server'
import { createHmac } from 'crypto'

export const runtime = 'nodejs'

const WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET

// POST /api/webhooks/n8n — N8N calls back into Shipinfy
// Use this as the "response webhook" URL in your N8N workflows
// Payload example: { action: "whatsapp_sent", driverName: "...", result: "..." }
export async function POST(req: Request) {
  try {
    // Verify signature if secret is configured
    if (WEBHOOK_SECRET) {
      const sig  = req.headers.get('X-N8N-Signature') ?? ''
      const body = await req.text()
      const expected = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`
      if (sig !== expected) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
      const payload = JSON.parse(body) as Record<string, unknown>
      return handleCallback(payload)
    }

    const payload = await req.json() as Record<string, unknown>
    return handleCallback(payload)
  } catch (e) {
    console.error('[webhooks/n8n]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function handleCallback(payload: Record<string, unknown>) {
  // Log callback — extend here to update DB based on N8N action results
  console.log('[N8N Callback]', JSON.stringify(payload))
  return NextResponse.json({ received: true, timestamp: new Date().toISOString() })
}
