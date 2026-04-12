import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/alerts/delivery?level=1&mode=standard&ack=false&limit=50
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const level = searchParams.get('level')
    const mode  = searchParams.get('mode')
    const ack   = searchParams.get('ack')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)

    const alerts = await prisma.deliveryAlert.findMany({
      where: {
        ...(level !== null ? { level: parseInt(level) } : {}),
        ...(mode  !== null ? { mode }  : {}),
        ...(ack   !== null ? { acknowledged: ack === 'true' } : {}),
      },
      orderBy: { triggeredAt: 'desc' },
      take:    limit,
    })

    return NextResponse.json(alerts)
  } catch (e) {
    console.error('[api/alerts/delivery GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
