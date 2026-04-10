import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// GET /api/score-ia — all latest scores (one per driver)
export async function GET() {
  try {
    // Get latest score per driverName
    const all = await prisma.reliabilityScore.findMany({
      orderBy: { calculatedAt: 'desc' },
    })
    // Deduplicate — keep only the latest per driverName
    const seen = new Set<string>()
    const latest = all.filter(s => {
      if (seen.has(s.driverName)) return false
      seen.add(s.driverName)
      return true
    })
    return NextResponse.json(latest)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
