export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, roleAtLeast } from '@/lib/auth'

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  if (!roleAtLeast(session.role, 'MANAGER')) {
    return NextResponse.json({ error: 'Accès refusé — MANAGER requis' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const reportId = searchParams.get('reportId')

  if (!reportId) {
    return NextResponse.json({ error: 'reportId requis' }, { status: 400 })
  }

  const rows = await prisma.driverPay.findMany({
    where: { reportId },
    orderBy: { netPay: 'desc' },
  })

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Aucune donnée pour ce rapport' }, { status: 404 })
  }

  const header = 'Livreur,Total Commandes,Livraisons,À temps,NO_SHOW,Brut (MAD),Bonus,Pénalité,Net (MAD)'
  const lines = rows.map(r => {
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    return [
      escape(r.driverName),
      r.total,
      r.deliveries,
      r.onTime,
      r.noShows,
      r.grossPay.toFixed(2),
      r.bonus.toFixed(2),
      r.penalty.toFixed(2),
      r.netPay.toFixed(2),
    ].join(',')
  })

  const csv = [header, ...lines].join('\n')
  const date = new Date().toISOString().slice(0, 10)

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="remuneration-${date}.csv"`,
    },
  })
}
