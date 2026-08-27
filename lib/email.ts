/**
 * lib/email.ts — Sprint 16 BLOC 1 — Provider abstraction email
 *
 * Deux providers :
 *   - resend : POST https://api.resend.com/emails (si SMTP_PROVIDER === 'resend')
 *   - smtp   : nodemailer via le transporter de lib/mailer.ts (défaut)
 *
 * Ne throw JAMAIS — retourne { ok:false, error } en cas d'échec + console.warn.
 * lib/mailer.ts reste intact et exporté pour compat.
 */

import { transporter } from '@/lib/mailer'

export interface EmailAttachment {
  filename:     string
  content:      Buffer
  contentType?: string
}

export interface SendEmailOptions {
  to:           string | string[]
  subject:      string
  text?:        string
  html?:        string
  attachments?: EmailAttachment[]
}

export interface SendEmailResult {
  ok:       boolean
  provider: string
  error?:   string
}

function resolveFrom(): string {
  return process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'no-reply@shipinfy.app'
}

// ─── Resend ───────────────────────────────────────────────────────────────────

async function sendViaResend(opts: SendEmailOptions): Promise<SendEmailResult> {
  const provider = 'resend'
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    const error = 'RESEND_API_KEY manquant'
    console.warn('[email] resend:', error)
    return { ok: false, provider, error }
  }

  try {
    const body: Record<string, unknown> = {
      from:    resolveFrom(),
      to:      Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
    }
    if (opts.text) body.text = opts.text
    if (opts.html) body.html = opts.html
    if (opts.attachments?.length) {
      body.attachments = opts.attachments.map((a) => ({
        filename: a.filename,
        content:  a.content.toString('base64'),
      }))
    }

    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body:   JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 500)
      const error = `Resend HTTP ${res.status} ${detail}`
      console.warn('[email]', error)
      return { ok: false, provider, error }
    }

    return { ok: true, provider }
  } catch (e) {
    const error = String(e)
    console.warn('[email] resend exception:', error)
    return { ok: false, provider, error }
  }
}

// ─── SMTP (nodemailer) ────────────────────────────────────────────────────────

async function sendViaSmtp(opts: SendEmailOptions): Promise<SendEmailResult> {
  const provider = 'smtp'
  try {
    await transporter.sendMail({
      from:    resolveFrom(),
      to:      Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
      subject: opts.subject,
      text:    opts.text,
      html:    opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename:    a.filename,
        content:     a.content,
        contentType: a.contentType,
      })),
    })
    return { ok: true, provider }
  } catch (e) {
    const error = String(e)
    console.warn('[email] smtp exception:', error)
    return { ok: false, provider, error }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  if (process.env.SMTP_PROVIDER === 'resend') {
    return sendViaResend(opts)
  }
  return sendViaSmtp(opts)
}

export async function verifySmtpConnection(): Promise<{ ok: boolean; error?: string; provider: string }> {
  if (process.env.SMTP_PROVIDER === 'resend') {
    const ok = Boolean(process.env.RESEND_API_KEY)
    return ok
      ? { ok: true, provider: 'resend' }
      : { ok: false, provider: 'resend', error: 'RESEND_API_KEY manquant' }
  }

  try {
    await transporter.verify()
    return { ok: true, provider: 'smtp' }
  } catch (e) {
    return { ok: false, provider: 'smtp', error: String(e) }
  }
}
