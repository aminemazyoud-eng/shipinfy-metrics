import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-guard'
import { assertSafeUrl } from '@/lib/safe-fetch'

export const runtime = 'nodejs'

// Champs renvoyés : JAMAIS le secret (seulement hasSecret)
const SAFE_SELECT = { id: true, name: true, webhookUrl: true, eventType: true, active: true, lastTriggeredAt: true, createdAt: true } as const

// GET /api/n8n/config — liste des configs (ADMIN)
export async function GET(req: NextRequest) {
  const auth = await requireSession(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const [rows, withSecret] = await Promise.all([
      prisma.n8NConfig.findMany({ select: SAFE_SELECT, orderBy: { createdAt: 'desc' } }),
      prisma.n8NConfig.findMany({ where: { secret: { not: null } }, select: { id: true } }),
    ])
    const has = new Set(withSecret.map(r => r.id))
    return NextResponse.json(rows.map(r => ({ ...r, hasSecret: has.has(r.id) })))
  } catch (e) {
    console.error('[api/n8n/config GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// POST /api/n8n/config — crée une config (ADMIN)
export async function POST(req: NextRequest) {
  const auth = await requireSession(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const body = await req.json()
    const { name, webhookUrl, eventType, secret, active } = body

    if (!name || !webhookUrl || !eventType) {
      return NextResponse.json({ error: 'name, webhookUrl, eventType requis' }, { status: 400 })
    }

    const VALID_EVENTS = ['report_ready', 'alert_critical', 'driver_onboarded', 'shift_assigned', '*']
    if (!VALID_EVENTS.includes(eventType)) {
      return NextResponse.json({ error: `eventType invalide. Valeurs: ${VALID_EVENTS.join(', ')}` }, { status: 400 })
    }
    try { await assertSafeUrl(String(webhookUrl)) } catch (e) {
      return NextResponse.json({ error: `URL de webhook refusée : ${e instanceof Error ? e.message : 'invalide'}` }, { status: 400 })
    }

    const config = await prisma.n8NConfig.create({
      data: { name, webhookUrl, eventType, secret: secret ?? null, active: active !== false },
      select: SAFE_SELECT,
    })
    return NextResponse.json({ ...config, hasSecret: !!secret }, { status: 201 })
  } catch (e) {
    console.error('[api/n8n/config POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
