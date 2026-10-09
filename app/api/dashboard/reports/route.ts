import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const _guard = await requireSession(req, 'VIEWER'); if ('error' in _guard) return _guard.error
  try {
    const reports = await prisma.deliveryReport.findMany({
      orderBy: { uploadedAt: 'desc' },
      include: { _count: { select: { orders: true } } },
    })
    return NextResponse.json(reports)
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
