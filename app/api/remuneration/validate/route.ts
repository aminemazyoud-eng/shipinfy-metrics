export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, roleAtLeast } from '@/lib/auth'

export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  if (!roleAtLeast(session.role, 'MANAGER')) {
    return NextResponse.json({ error: 'Accès refusé — MANAGER requis' }, { status: 403 })
  }

  const { reportId } = await req.json()

  if (!reportId) {
    return NextResponse.json({ error: 'reportId requis' }, { status: 400 })
  }

  // Use raw SQL to update the columns added via ALTER TABLE (not in Prisma schema)
  await prisma.$executeRaw`
    UPDATE "DeliveryReport"
    SET "payValidated" = true,
        "payValidatedAt" = NOW(),
        "payValidatedBy" = ${session.email}
    WHERE "id" = ${reportId}
  `

  return NextResponse.json({ ok: true, validatedBy: session.email, validatedAt: new Date().toISOString() })
}

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const reportId = searchParams.get('reportId')

  if (!reportId) return NextResponse.json({ payValidated: false })

  const result = await prisma.$queryRaw<{ payValidated: boolean; payValidatedAt: Date | null; payValidatedBy: string | null }[]>`
    SELECT "payValidated", "payValidatedAt", "payValidatedBy"
    FROM "DeliveryReport"
    WHERE "id" = ${reportId}
    LIMIT 1
  `

  if (!result || result.length === 0) return NextResponse.json({ payValidated: false })

  return NextResponse.json(result[0])
}
