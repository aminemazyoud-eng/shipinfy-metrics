import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// GET /api/n8n/config — list all N8N webhook configs
export async function GET() {
  try {
    const configs = await prisma.n8NConfig.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(configs)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// POST /api/n8n/config — create a new N8N webhook config
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, webhookUrl, eventType, secret, active } = body

    if (!name || !webhookUrl || !eventType) {
      return NextResponse.json(
        { error: 'name, webhookUrl, eventType requis' },
        { status: 400 },
      )
    }

    const VALID_EVENTS = ['report_ready', 'alert_critical', 'driver_onboarded', 'shift_assigned', '*']
    if (!VALID_EVENTS.includes(eventType)) {
      return NextResponse.json(
        { error: `eventType invalide. Valeurs: ${VALID_EVENTS.join(', ')}` },
        { status: 400 },
      )
    }

    const config = await prisma.n8NConfig.create({
      data: {
        name,
        webhookUrl,
        eventType,
        secret:  secret ?? null,
        active:  active !== false,
      },
    })
    return NextResponse.json(config, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
