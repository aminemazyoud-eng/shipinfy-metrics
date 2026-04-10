import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

type RouteCtx = { params: Promise<{ driverName: string }> }

export async function GET(_: Request, { params }: RouteCtx) {
  try {
    const { driverName } = await params
    const decoded = decodeURIComponent(driverName)
    const scores = await prisma.reliabilityScore.findMany({
      where: { driverName: decoded },
      orderBy: { calculatedAt: 'desc' },
      take: 30,
    })
    return NextResponse.json(scores)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
