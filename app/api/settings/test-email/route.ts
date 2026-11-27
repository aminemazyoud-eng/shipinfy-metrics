import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'
import { audit } from '@/lib/ops-auth'

export const runtime = 'nodejs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// POST /api/settings/test-email { email } — envoie un court message pour vérifier la configuration d'envoi (Paramètres › Notifications).
// MANAGER+ ; aucune donnée de commande, aucun PDF.
export async function POST(request: Request) {
  const _guard = await requireSession(request, 'MANAGER'); if ('error' in _guard) return _guard.error
  try {
    const { email } = (await request.json()) as { email?: string }
    const to = String(email ?? '').trim()
    if (!EMAIL_RE.test(to)) return NextResponse.json({ error: 'Adresse email invalide' }, { status: 400 })
    const r = await sendEmail({
      to,
      subject: 'Test d’envoi — Shipinfy Metrics',
      text: 'Ce message confirme que l’envoi d’emails de Shipinfy Metrics fonctionne.\nLes rapports planifiés partiront vers cette adresse si vous la choisissez comme destinataire.\n\n— Shipinfy Metrics',
    })
    await audit(_guard.session, 'settings.test_email', 'email', null, { ok: r.ok, provider: r.provider })
    return r.ok ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, error: r.error ?? 'Envoi en échec' }, { status: 502 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, error: 'Envoi impossible' }, { status: 500 })
  }
}
