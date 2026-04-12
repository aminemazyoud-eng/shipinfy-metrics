import { NextResponse } from 'next/server'
import { triggerN8N, type N8NEventType } from '@/lib/n8n-bridge'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// POST /api/n8n/test — fire a test event to a specific config
// Body: { configId?: string, eventType?: N8NEventType }
export async function POST(req: Request) {
  try {
    const body      = await req.json()
    const eventType = (body.eventType ?? 'report_ready') as N8NEventType
    const configId  = body.configId as string | undefined

    // If targeting a specific config, fire directly
    if (configId) {
      const cfg = await prisma.n8NConfig.findUnique({ where: { id: configId } })
      if (!cfg) return NextResponse.json({ error: 'Config introuvable' }, { status: 404 })

      const payload = JSON.stringify({
        eventType,
        triggeredAt: new Date().toISOString(),
        data: { test: true, message: 'Test depuis Shipinfy Paramètres', configName: cfg.name },
      })

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (cfg.secret) {
        const { createHmac } = await import('crypto')
        const sig = createHmac('sha256', cfg.secret).update(payload).digest('hex')
        headers['X-Shipinfy-Signature'] = `sha256=${sig}`
      }

      const res = await fetch(cfg.webhookUrl, { method: 'POST', headers, body: payload })
      await prisma.n8NConfig.update({
        where: { id: configId },
        data:  { lastTriggeredAt: new Date() },
      }).catch(() => {})

      return NextResponse.json({ ok: res.ok, status: res.status, configName: cfg.name })
    }

    // Otherwise fan-out to all active configs for this event
    await triggerN8N(eventType, {
      test: true,
      message: 'Test depuis Shipinfy Paramètres',
    })

    return NextResponse.json({ ok: true, eventType })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
