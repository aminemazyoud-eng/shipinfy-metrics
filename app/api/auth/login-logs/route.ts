export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const logs = await prisma.$queryRaw<{
    id: string
    userId: string
    email: string
    tenantId: string | null
    ip: string | null
    userAgent: string | null
    status: string
    createdAt: Date
  }[]>`
    SELECT "id", "userId", "email", "tenantId", "ip", "userAgent", "status", "createdAt"
    FROM "LoginLog"
    WHERE "userId" = ${session.userId}
    ORDER BY "createdAt" DESC
    LIMIT 20
  `

  return NextResponse.json(logs)
}
