import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { applyN8nResult, type NotifyChannel } from '@/lib/notify'
import { requireEnv, envUnavailable } from '@/lib/env'
import { limited } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const WINDOW_MS = 5 * 60_000

// POST /api/webhooks/n8n — N8N rappelle Shipinfy (callback de livraison).
// Authentification OBLIGATOIRE : secret N8N_WEBHOOK_SECRET (503 s'il n'est pas configuré).
//   X-Timestamp : secondes ou millisecondes epoch (fenêtre ±5 min)
//   X-Signature : HMAC-SHA256 hex de `${timestamp}.${corps brut}` (préfixe « sha256= » toléré)
//
// Résultat par canal : { notificationId, channel: "email"|"slack"|"whatsapp", status: "delivered"|"failed", sentTo?, error? }
// Les payloads historiques (basés sur « action ») sont acceptés et seulement journalisés.
export async function POST(req: Request) {
  const lim = limited(req, 'webhook-n8n', 120, 60_000)
  if (lim) return lim
  try {
    const secret = requireEnv('N8N_WEBHOOK_SECRET')
    const tsHeader = req.headers.get('x-timestamp') ?? ''
    const sig = (req.headers.get('x-signature') ?? '').replace(/^sha256=/i, '')
    const body = await req.text()

    // horodatage : secondes (≤ 11 chiffres) ou millisecondes, fenêtre ±5 min
    const tsNum = Number(tsHeader)
    if (!tsHeader || !Number.isFinite(tsNum)) return NextResponse.json({ error: 'Signature invalide' }, { status: 401 })
    const tsMs = tsNum < 1e11 ? tsNum * 1000 : tsNum
    if (Math.abs(Date.now() - tsMs) > WINDOW_MS) return NextResponse.json({ error: 'Horodatage hors fenêtre' }, { status: 401 })

    const expected = createHmac('sha256', secret).update(`${tsHeader}.${body}`).digest('hex')
    const a = Buffer.from(sig), b = Buffer.from(expected)
    if (!sig || a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: 'Signature invalide' }, { status: 401 })

    let payload: Record<string, unknown>
    try { payload = JSON.parse(body) as Record<string, unknown> } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

    return handleCallback(payload)
  } catch (e) {
    const env = envUnavailable(e); if (env) return env
    console.error('[webhooks/n8n]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
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

  // Callback historique / non structuré — simple journalisation
  console.log('[N8N Callback]', JSON.stringify(payload).slice(0, 1000))
  return NextResponse.json({ received: true, timestamp: new Date().toISOString() })
}
