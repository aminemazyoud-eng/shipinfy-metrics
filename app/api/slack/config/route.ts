import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/slack/config — récupère la config active
export async function GET() {
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
  try {
    const body = await req.json() as { webhookUrl?: string; channel?: string; active?: boolean }
    if (!body.webhookUrl) {
      return NextResponse.json({ error: 'webhookUrl requis' }, { status: 400 })
    }

    // Désactiver les anciennes configs
    await prisma.slackConfig.updateMany({ where: { active: true }, data: { active: false } })

    const config = await prisma.slackConfig.create({
      data: {
        webhookUrl: body.webhookUrl,
        channel:    body.channel ?? '#alertes-livraison',
        active:     body.active  ?? true,
      },
    })

    return NextResponse.json(config)
  } catch (e) {
    console.error('[api/slack/config POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// POST /api/slack/config/test via query param ?test=1
// → tester le webhook avec un message de test
export async function PUT(req: NextRequest) {
  try {
    const body   = await req.json() as { webhookUrl: string }
    if (!body.webhookUrl) return NextResponse.json({ error: 'webhookUrl requis' }, { status: 400 })

    const res = await fetch(body.webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: '✅ *Shipinfy Metrics* — Test de connexion Slack réussi !' }),
    })

    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ ok: false, error: txt }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
