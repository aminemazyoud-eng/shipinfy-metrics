import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// GET /api/notifications?kind=report|alert&status=...&days=30&limit=100
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const kind   = searchParams.get('kind') ?? undefined
    const status = searchParams.get('status') ?? undefined
    const days   = Math.min(parseInt(searchParams.get('days') ?? '30'), 365)
    const limit  = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500)

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const where = {
      createdAt: { gte: since },
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
    }

    const rows = await prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    const items = rows.map(r => ({
      id:          r.id,
      kind:        r.kind,
      event:       r.event,
      title:       r.title,
      summary:     r.summary,
      recipients:  r.recipients,
      channels:    safeParse<string[]>(r.channels) ?? [],
      results:     safeParse<unknown[]>(r.results) ?? [],
      status:      r.status,
      mode:        r.mode,
      pdfFilename: r.pdfFilename,
      alertLevel:  r.alertLevel,
      createdAt:   r.createdAt.toISOString(),
    }))

    // Stats (sur la fenêtre demandée, tous kinds confondus)
    const all = await prisma.notificationLog.findMany({
      where: { createdAt: { gte: since } },
      select: { status: true, createdAt: true, kind: true },
    })
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
    const todayCount = all.filter(x => x.createdAt >= startToday).length
    const delivered  = all.filter(x => x.status === 'delivered').length
    const failed     = all.filter(x => x.status === 'failed' || x.status === 'partial').length
    const total      = all.length

    return NextResponse.json({
      items,
      stats: {
        total,
        today:       todayCount,
        delivered,
        failed,
        successRate: total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0,
        reports:     all.filter(x => x.kind === 'report').length,
        alerts:      all.filter(x => x.kind === 'alert').length,
      },
    })
  } catch (e) {
    console.error('[api/notifications GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}
