import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, roleAtLeast } from '@/lib/auth'

export const runtime = 'nodejs'

// POST /api/debug/slack-test — envoie un message de test au webhook Slack actif
export async function POST(req: Request) {
  const s = await getSession(req)
  if (s && !roleAtLeast(s.role, 'ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const config = await prisma.slackConfig.findFirst({ where: { active: true } })
  if (!config?.webhookUrl) {
    return NextResponse.json({ error: 'Aucune config Slack active' }, { status: 404 })
  }

  try {
    const res = await fetch(config.webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: ':white_check_mark: Test Shipinfy — ' + new Date().toISOString() }),
      signal:  AbortSignal.timeout(8000),
    })

    const responseBody = (await res.text().catch(() => '')).slice(0, 500)

    return NextResponse.json({
      success:      res.ok,
      responseCode: res.status,
      responseBody,
      webhookHost:  new URL(config.webhookUrl).host,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) })
  }
}
