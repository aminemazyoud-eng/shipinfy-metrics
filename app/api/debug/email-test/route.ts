import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'
import { getSession, roleAtLeast } from '@/lib/auth'

export const runtime = 'nodejs'

// GET /api/debug/email-test — envoie un email de test vers SMTP_TEST_TO
export async function GET(req: Request) {
  const s = await getSession(req)
  if (s && !roleAtLeast(s.role, 'ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const to = process.env.SMTP_TEST_TO
  if (!to) {
    return NextResponse.json({ error: 'SMTP_TEST_TO non configuré' }, { status: 400 })
  }

  const result = await sendEmail({
    to,
    subject: `Test Shipinfy Metrics — ${new Date().toISOString()}`,
    text:    'Ceci est un email de test envoyé depuis /api/debug/email-test.',
    html:    '<p>Ceci est un email de test envoyé depuis <code>/api/debug/email-test</code>.</p>',
  })

  return NextResponse.json({
    success:  result.ok,
    provider: result.provider,
    error:    result.error ?? null,
    config: {
      host:         process.env.SMTP_HOST ?? null,
      port:         process.env.SMTP_PORT ?? null,
      from:         process.env.SMTP_FROM ?? null,
      provider:     process.env.SMTP_PROVIDER ?? 'smtp',
      hasPass:      Boolean(process.env.SMTP_PASS),
      hasResendKey: Boolean(process.env.RESEND_API_KEY),
    },
  })
}
