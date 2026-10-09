import { NextRequest, NextResponse } from 'next/server'
import { triggerN8N, type N8NEventType } from '@/lib/n8n-bridge'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-guard'
import { safeFetch } from '@/lib/safe-fetch'
import { audit } from '@/lib/ops-auth'

export const runtime = 'nodejs'

// POST /api/n8n/test (ADMIN) — envoie un événement de test à une config précise ou à toutes les configs actives
// Body: { configId?: string, eventType?: N8NEventType }
export async function POST(req: NextRequest) {
  const auth = await requireSession(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const body      = await req.json()
    const eventType = (body.eventType ?? 'report_ready') as N8NEventType
    const configId  = body.configId as string | undefined

    // Config ciblée : appel direct, via safeFetch (anti-SSRF) — le corps de la réponse n'est jamais renvoyé
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

      let res: Response
      try {
        res = await safeFetch(cfg.webhookUrl, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(10000) })
      } catch (e) {
        return NextResponse.json({ ok: false, error: `URL de webhook refusée ou injoignable : ${e instanceof Error ? e.message : 'erreur'}` }, { status: 400 })
      }
      await prisma.n8NConfig.update({
        where: { id: configId },
        data:  { lastTriggeredAt: new Date() },
      }).catch(() => {})

      await audit(auth.session, 'n8n.test', 'n8nConfig', configId, { eventType, ok: res.ok, status: res.status })
      return NextResponse.json({ ok: res.ok, status: res.status, configName: cfg.name })
    }

    // Vérifier qu'il existe au moins une config active pour cet event avant de prétendre que le test a réussi
    // (triggerN8N ne fait rien silencieusement si aucune config ne correspond).
    const matching = await prisma.n8NConfig.count({
      where: { active: true, OR: [{ eventType }, { eventType: '*' }] },
    })
    if (matching === 0) {
      return NextResponse.json({ ok: false, eventType, warning: 'Aucune config N8N active pour cet événement' })
    }

    // Fan-out vers toutes les configs actives pour cet événement
    await triggerN8N(eventType, {
      test: true,
      message: 'Test depuis Shipinfy Paramètres',
    })

    await audit(auth.session, 'n8n.test', 'n8nConfig', null, { eventType, configsNotified: matching })
    return NextResponse.json({ ok: true, eventType, configsNotified: matching })
  } catch (e) {
    console.error('[api/n8n/test]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
