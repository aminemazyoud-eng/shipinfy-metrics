export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, deleteUserSessions, MIN_PASSWORD_LENGTH } from '@/lib/auth'
import { limited } from '@/lib/rate-limit'

export async function POST(req: Request) {
  const tooMany = limited(req, 'reset-password', 10, 60 * 60_000)
  if (tooMany) return tooMany
  try {
    const { token, newPassword } = await req.json()

    if (!token || !newPassword) {
      return NextResponse.json({ error: 'Token et nouveau mot de passe requis' }, { status: 400 })
    }

    if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` }, { status: 400 })
    }

    // Find token via raw SQL (table not in Prisma schema)
    const resets = await prisma.$queryRaw<{
      id: string
      userId: string
      expiresAt: Date
      usedAt: Date | null
    }[]>`
      SELECT "id", "userId", "expiresAt", "usedAt"
      FROM "PasswordReset"
      WHERE "token" = ${token}
      LIMIT 1
    `

    if (!resets || resets.length === 0) {
      return NextResponse.json({ error: 'Token invalide ou expiré' }, { status: 400 })
    }

    const reset = resets[0]

    if (reset.usedAt) {
      return NextResponse.json({ error: 'Ce lien a déjà été utilisé' }, { status: 400 })
    }

    if (new Date(reset.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Ce lien a expiré' }, { status: 400 })
    }

    // Update password
    const hashed = hashPassword(newPassword)
    await prisma.user.update({
      where: { id: reset.userId },
      data: { password: hashed },
    })

    // Mark token as used
    await prisma.$executeRaw`
      UPDATE "PasswordReset"
      SET "usedAt" = NOW()
      WHERE "id" = ${reset.id}
    `

    // Toutes les sessions existantes sont révoquées
    await deleteUserSessions(reset.userId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[reset-password]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
