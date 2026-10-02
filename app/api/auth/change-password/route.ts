import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, hashPassword, verifyPassword } from '@/lib/auth'

export const runtime = 'nodejs'

// POST /api/auth/change-password — l'utilisateur connecté change son propre mot de passe
// Body: { currentPassword: string, newPassword: string }
export async function POST(req: Request) {
  try {
    const session = await getSession(req)
    if (!session) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const body = await req.json() as { currentPassword?: string; newPassword?: string }
    const { currentPassword, newPassword } = body

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Mot de passe actuel et nouveau mot de passe requis' }, { status: 400 })
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } })
    if (!user) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    }

    if (!verifyPassword(currentPassword, user.password)) {
      return NextResponse.json({ error: 'Mot de passe actuel incorrect' }, { status: 400 })
    }

    await prisma.user.update({
      where: { id: user.id },
      data:  { password: hashPassword(newPassword) },
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[auth/change-password]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
