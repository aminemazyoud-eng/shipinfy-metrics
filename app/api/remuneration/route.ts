import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/remuneration?reportId=xxx&mode=standard
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const reportId = searchParams.get('reportId')
    const mode     = searchParams.get('mode') ?? undefined

    if (!reportId) return NextResponse.json({ error: 'reportId requis' }, { status: 400 })

    const pays = await prisma.driverPay.findMany({
      where:   { reportId, ...(mode ? { mode } : {}) },
      orderBy: { netPay: 'desc' },
    })

    return NextResponse.json(pays)
  } catch (e) {
    console.error('[api/remuneration GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
