/**
 * lib/notify.ts — Sprint 17 — Point d'entrée unique des notifications sortantes
 *
 * Deux modes (env NOTIFY_MODE) :
 *   - "direct" (défaut) : l'app envoie elle-même (email via lib/email, Slack via SlackConfig)
 *   - "n8n"             : l'app délègue tout à n8n (triggerN8N), n8n renvoie les résultats
 *                         via POST /api/webhooks/n8n → mise à jour du NotificationLog
 *
 * Toujours : 1 ligne NotificationLog par appel → visible dans /notifications.
 * Ne throw JAMAIS (les notifications ne doivent pas casser le flux métier).
 */

import { prisma } from '@/lib/prisma'
import { sendEmail, type EmailAttachment } from '@/lib/email'
import { sendWhatsApp } from '@/lib/whatsapp'
import { triggerN8N, type N8NEventType } from '@/lib/n8n-bridge'
import { safeFetch } from '@/lib/safe-fetch'

export type NotifyChannel = 'email' | 'slack' | 'whatsapp'
export type NotifyKind    = 'report' | 'alert'

export interface NotifyInput {
  kind:         NotifyKind
  event:        N8NEventType
  title:        string
  summary:      string
  channels?:    NotifyChannel[]              // canaux souhaités (défaut selon kind)
  recipients?:  string[]                     // emails / téléphones
  data?:        Record<string, unknown>      // données complètes (KPIs, alerte…)
  pdfBase64?:   string
  pdfFilename?: string
  reportId?:    string
  alertLevel?:  number
  tenantId?:    string | null
  // fallback mode "direct" — email
  emailSubject?:     string
  emailText?:        string
  emailHtml?:        string
  emailAttachments?: EmailAttachment[]
}

export interface ChannelResult {
  channel: NotifyChannel
  status:  'delivered' | 'partial' | 'failed' | 'skipped'   // partial : certains destinataires seulement (voir error)
  sentTo?: string
  error?:  string
  at:      string
}

export interface NotifyResult {
  notificationId: string
  mode:           'direct' | 'n8n'
  status:         string
  results:        ChannelResult[]
}

function notifyMode(): 'direct' | 'n8n' {
  return process.env.NOTIFY_MODE === 'n8n' ? 'n8n' : 'direct'
}

function defaultChannels(kind: NotifyKind): NotifyChannel[] {
  return kind === 'report' ? ['email'] : ['slack']
}

function computeStatus(results: ChannelResult[], mode: 'direct' | 'n8n'): string {
  const active = results.filter(r => r.status !== 'skipped')
  if (active.length === 0) return mode === 'n8n' ? 'sent_to_n8n' : 'failed'
  const delivered = active.filter(r => r.status === 'delivered').length
  const partial   = active.filter(r => r.status === 'partial').length
  if (delivered === active.length) return 'delivered'
  if (delivered === 0 && partial === 0) return 'failed'
  return 'partial'
}

// ─── Direct senders ──────────────────────────────────────────────────────────

async function sendSlackDirect(text: string): Promise<ChannelResult> {
  const at = new Date().toISOString()
  try {
    const config = await prisma.slackConfig.findFirst({ where: { active: true } })
    if (!config?.webhookUrl) {
      return { channel: 'slack', status: 'failed', error: 'Aucune config Slack active', at }
    }
    // webhook saisi par un utilisateur : safeFetch (https, hôte autorisé, IP privées refusées, pas de redirection)
    const res = await safeFetch(config.webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    })
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300)
      return { channel: 'slack', status: 'failed', error: `HTTP ${res.status} ${body}`, sentTo: config.channel, at }
    }
    return { channel: 'slack', status: 'delivered', sentTo: config.channel, at }
  } catch (e) {
    return { channel: 'slack', status: 'failed', error: String(e).slice(0, 300), at }
  }
}

async function sendEmailDirect(input: NotifyInput): Promise<ChannelResult> {
  const at = new Date().toISOString()
  const to = input.recipients ?? []
  if (to.length === 0) {
    return { channel: 'email', status: 'failed', error: 'Aucun destinataire', at }
  }
  const attachments =
    input.emailAttachments ??
    (input.pdfBase64
      ? [{
          filename:    input.pdfFilename ?? 'rapport.pdf',
          content:     Buffer.from(input.pdfBase64, 'base64'),
          contentType: 'application/pdf',
        }]
      : undefined)

  const r = await sendEmail({
    to,
    subject:     input.emailSubject ?? input.title,
    text:        input.emailText ?? input.summary,
    html:        input.emailHtml,
    attachments,
  })
  return r.ok
    ? { channel: 'email', status: 'delivered', sentTo: to.join(', '), at }
    : { channel: 'email', status: 'failed', sentTo: to.join(', '), error: r.error, at }
}

async function sendWhatsAppDirect(input: NotifyInput): Promise<ChannelResult> {
  const at = new Date().toISOString()
  const to = input.recipients ?? []
  if (to.length === 0) {
    return { channel: 'whatsapp', status: 'failed', error: 'Aucun destinataire', at }
  }
  const message = input.emailText ?? `${input.title}\n${input.summary}`
  const failed: string[] = []
  let delivered = 0
  for (const phone of to) {
    if (await sendWhatsApp(phone, message)) delivered++
    else failed.push(phone)
  }
  if (delivered === 0) {
    return { channel: 'whatsapp', status: 'failed', sentTo: to.join(', '), error: 'Aucun envoi réussi', at }
  }
  // 'delivered' seulement si TOUS les destinataires ont reçu ; sinon 'partial' avec la liste des échecs
  return {
    channel: 'whatsapp',
    status:  failed.length === 0 ? 'delivered' : 'partial',
    sentTo:  to.join(', '),
    error:   failed.length > 0 ? `Échec pour : ${failed.join(', ')}` : undefined,
    at,
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const mode     = notifyMode()
  const channels = input.channels ?? defaultChannels(input.kind)

  // 1. Créer la ligne de log (source de vérité pour /notifications)
  let log: { id: string }
  try {
    log = await prisma.notificationLog.create({
      data: {
        kind:        input.kind,
        event:       input.event,
        title:       input.title.slice(0, 300),
        summary:     input.summary.slice(0, 1000),
        recipients:  input.recipients?.join(', ') ?? null,
        channels:    JSON.stringify(channels),
        status:      'pending',
        mode,
        pdfFilename: input.pdfFilename ?? null,
        reportId:    input.reportId ?? null,
        alertLevel:  input.alertLevel ?? null,
        tenantId:    input.tenantId ?? null,
        payloadJson: safePayload(input),
      },
      select: { id: true },
    })
  } catch (e) {
    console.error('[notify] impossible de créer NotificationLog:', e)
    return { notificationId: '', mode, status: 'failed', results: [] }
  }

  // 2. Mode n8n → déléguer et sortir
  if (mode === 'n8n') {
    // On lit le résultat : 'sent_to_n8n' UNIQUEMENT si la délégation a réussi (n8n-bridge peut renvoyer { ok, delivered, error } ou lever).
    let n8nOk = true
    let n8nErr: string | undefined
    try {
      const r = await triggerN8N(input.event, {
      notificationId: log.id,
      kind:           input.kind,
      title:          input.title,
      summary:        input.summary,
      channels,
      recipients:     input.recipients ?? [],
      alertLevel:     input.alertLevel ?? null,
      reportId:       input.reportId ?? null,
      pdfFilename:    input.pdfFilename ?? null,
      pdfBase64:      input.pdfBase64 ?? null,
      data:           input.data ?? {},
      }) as unknown as { ok?: boolean; delivered?: number; error?: string } | void
      if (r && typeof r === 'object' && (r.ok === false || r.delivered === 0)) { n8nOk = false; n8nErr = r.error ?? 'n8n : aucun webhook joint' }
    } catch (e) {
      n8nOk = false
      n8nErr = String(e).slice(0, 300)
    }

    if (!n8nOk) {
      const at = new Date().toISOString()
      const results: ChannelResult[] = channels.map(ch => ({ channel: ch, status: 'failed' as const, error: n8nErr, at }))
      await prisma.notificationLog.update({
        where: { id: log.id },
        data:  { status: 'failed', results: JSON.stringify(results) },
      }).catch(() => {})
      return { notificationId: log.id, mode, status: 'failed', results }
    }

    await prisma.notificationLog.update({
      where: { id: log.id },
      data:  { status: 'sent_to_n8n' },
    }).catch(() => {})

    return { notificationId: log.id, mode, status: 'sent_to_n8n', results: [] }
  }

  // 3. Mode direct → l'app envoie
  const results: ChannelResult[] = []
  for (const ch of channels) {
    if (ch === 'email')         results.push(await sendEmailDirect(input))
    else if (ch === 'slack')    results.push(await sendSlackDirect(slackText(input)))
    else if (ch === 'whatsapp') results.push(await sendWhatsAppDirect(input))
    else results.push({ channel: ch, status: 'skipped', error: 'canal non géré en mode direct', at: new Date().toISOString() })
  }

  const status = computeStatus(results, mode)
  await prisma.notificationLog.update({
    where: { id: log.id },
    data:  { status, results: JSON.stringify(results) },
  }).catch(() => {})

  return { notificationId: log.id, mode, status, results }
}

// n8n callback → mise à jour d'une ligne existante
export async function applyN8nResult(
  notificationId: string,
  channel: NotifyChannel,
  status: 'delivered' | 'failed',
  extra?: { sentTo?: string; error?: string },
): Promise<void> {
  const log = await prisma.notificationLog.findUnique({ where: { id: notificationId } })
  if (!log) return

  const existing: ChannelResult[] = safeParse(log.results) ?? []
  const filtered = existing.filter(r => r.channel !== channel)
  filtered.push({ channel, status, sentTo: extra?.sentTo, error: extra?.error, at: new Date().toISOString() })

  await prisma.notificationLog.update({
    where: { id: notificationId },
    data:  {
      results: JSON.stringify(filtered),
      status:  computeStatus(filtered, 'n8n'),
    },
  }).catch(() => {})
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function slackText(input: NotifyInput): string {
  const icon = input.kind === 'alert'
    ? (input.alertLevel && input.alertLevel >= 3 ? '🔴' : '🟠')
    : '📦'
  return `${icon} *${input.title}*\n${input.summary}`
}

function safePayload(input: NotifyInput): string {
  try {
    const p = {
      kind: input.kind, event: input.event, title: input.title, summary: input.summary,
      channels: input.channels, recipients: input.recipients,
      reportId: input.reportId, alertLevel: input.alertLevel,
      data: input.data,
    }
    return JSON.stringify(p).slice(0, 4000)
  } catch {
    return ''
  }
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}
