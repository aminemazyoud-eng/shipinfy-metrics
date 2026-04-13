/**
 * lib/n8n-bridge.ts — Sprint 11 — N8N + WhatsApp
 *
 * Shipinfy exposes webhooks that N8N consumes.
 * triggerN8N fans out to all active N8NConfig records matching the eventType.
 * Each config receives a POST with { eventType, triggeredAt, data }.
 * N8N then handles the WhatsApp / SMS / whatever automation.
 */

import { prisma } from '@/lib/prisma'
import { createHmac } from 'crypto'

export type N8NEventType =
  | 'report_ready'
  | 'alert_critical'
  | 'driver_onboarded'
  | 'shift_assigned'
  | '*'

export interface N8NPayload {
  eventType:   N8NEventType
  triggeredAt: string
  data:        Record<string, unknown>
}

// ── Fan-out to all active configs for this event ─────────────────────────────

export async function triggerN8N(
  eventType: N8NEventType,
  data:      Record<string, unknown>,
): Promise<void> {
  try {
    const configs = await prisma.n8NConfig.findMany({
      where: {
        active: true,
        OR: [
          { eventType },
          { eventType: '*' },
        ],
      },
    })
    if (configs.length === 0) return

    const payload: N8NPayload = {
      eventType,
      triggeredAt: new Date().toISOString(),
      data,
    }

    await Promise.allSettled(
      configs.map(async (cfg: { id: string; name: string; webhookUrl: string; secret: string | null }) => {
        const payloadStr = JSON.stringify(payload)
        const payloadTruncated = payloadStr.length > 500 ? payloadStr.slice(0, 500) : payloadStr
        let responseCode: number | undefined
        try {
          const body    = payloadStr
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          }

          // Optional HMAC signature (N8N can verify via expression)
          if (cfg.secret) {
            const sig = createHmac('sha256', cfg.secret).update(body).digest('hex')
            headers['X-Shipinfy-Signature'] = `sha256=${sig}`
          }

          const res = await fetch(cfg.webhookUrl, { method: 'POST', headers, body })
          responseCode = res.status

          // Update lastTriggeredAt — best-effort, don't await failure
          await prisma.n8NConfig.update({
            where: { id: cfg.id },
            data:  { lastTriggeredAt: new Date() },
          }).catch(() => {})

          // Log success
          await prisma.n8NLog.create({
            data: {
              configId:     cfg.id,
              eventType:    eventType,
              status:       'success',
              responseCode: responseCode,
              payload:      payloadTruncated,
            },
          }).catch(() => {})
        } catch (e) {
          console.error(`[N8NBridge] Failed to trigger ${cfg.name} (${cfg.webhookUrl}):`, e)
          // Log error
          await prisma.n8NLog.create({
            data: {
              configId:     cfg.id,
              eventType:    eventType,
              status:       'error',
              responseCode: responseCode ?? null,
              payload:      payloadTruncated,
              error:        String(e).slice(0, 500),
            },
          }).catch(() => {})
        }
      }),
    )
  } catch (e) {
    // Never crash caller — N8N integration is non-blocking
    console.error('[N8NBridge] triggerN8N error:', e)
  }
}
