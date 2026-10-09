import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-guard'

export const runtime = 'nodejs'

// GET /api/n8n/logs — journal des 50 derniers appels (MANAGER)
export async function GET(req: NextRequest) {
  const auth = await requireSession(req, 'MANAGER')
  if ('error' in auth) return auth.error

  const logs = await prisma.n8NLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json(logs)
}
