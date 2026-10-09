import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// GET /api/score-ia — all latest scores (one per driver)
export async function GET(req: Request) {
  const _guard = await requireSession(req, 'VIEWER'); if ('error' in _guard) return _guard.error
  try {
    // Dernier score par livreur (DISTINCT côté base : plus de lecture de tout l'historique).
    // Les lignes exposent aussi reportId / coefficients / ordersCount / scoreVersion.
    const latest = await prisma.reliabilityScore.findMany({
      orderBy: [{ driverName: 'asc' }, { calculatedAt: 'desc' }],
      distinct: ['driverName'],
    })
    // Ordre historique conservé : plus récent d'abord
    latest.sort((a, b) => b.calculatedAt.getTime() - a.calculatedAt.getTime())
    return NextResponse.json(latest)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
