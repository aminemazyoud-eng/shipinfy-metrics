import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-guard'
import { assertSafeUrl, safeFetch } from '@/lib/safe-fetch'
import { audit } from '@/lib/ops-auth'

// Toutes les routes : ADMIN. L'URL du webhook est validée (https + hôte autorisé + adresse non interne) avant tout enregistrement ou appel.
const badUrl = (e: unknown) => NextResponse.json({ error: `URL de webhook refusée : ${e instanceof Error ? e.message : 'invalide'}` }, { status: 400 })

// GET /api/slack/config — récupère la config active
export async function GET(req: NextRequest) {
  const auth = await requireSession(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const config = await prisma.slackConfig.findFirst({ where: { active: true } })
    return NextResponse.json(config ?? { webhookUrl: '', channel: '#alertes-livraison', active: false })
  } catch (e) {
    console.error('[api/slack/config GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// POST /api/slack/config — crée ou met à jour
// Body: { webhookUrl, channel, active }
export async function POST(req: NextRequest) {
  const auth = await requireSession(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const body = await req.json() as { webhookUrl?: string; channel?: string; active?: boolean }
    if (!body.webhookUrl) {
      return NextResponse.json({ error: 'webhookUrl requis' }, { status: 400 })
    }
    try { await assertSafeUrl(body.webhookUrl) } catch (e) { return badUrl(e) }

    // Désactiver les anciennes configs
    await prisma.slackConfig.updateMany({ where: { active: true }, data: { active: false } })

    const config = await prisma.slackConfig.create({
      data: {
        webhookUrl: body.webhookUrl,
        channel:    body.channel ?? '#alertes-livraison',
        active:     body.active  ?? true,
      },
    })

    await audit(auth.session, 'slack.config', 'slackConfig', config.id, { channel: config.channel, active: config.active }) // l'URL du webhook n'est jamais journalisée
    return NextResponse.json(config)
  } catch (e) {
    console.error('[api/slack/config POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// PUT /api/slack/config — teste le webhook avec un message de test (le corps de la réponse n'est JAMAIS renvoyé : anti-SSRF lecture)
export async function PUT(req: NextRequest) {
  const auth = await requireSession(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const body = await req.json() as { webhookUrl?: string }
    if (!body.webhookUrl) return NextResponse.json({ error: 'webhookUrl requis' }, { status: 400 })
    try { await assertSafeUrl(body.webhookUrl) } catch (e) { return badUrl(e) }

    const res = await safeFetch(body.webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: '✅ *Shipinfy Metrics* — Test de connexion Slack réussi !' }),
    })

    if (!res.ok) return NextResponse.json({ ok: false, error: `Slack a répondu HTTP ${res.status}` }, { status: 400 })
    await audit(auth.session, 'slack.test', 'slackConfig', null, { ok: true })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/slack/config PUT]', e)
    return NextResponse.json({ ok: false, error: "Échec de l'appel au webhook" }, { status: 502 })
  }
}
