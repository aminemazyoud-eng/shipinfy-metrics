import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, createSession, buildSessionCookie } from '@/lib/auth'

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

    if (!user || !user.active) {
      return NextResponse.json({ error: 'Identifiants invalides' }, { status: 401 })
    }

    const valid = verifyPassword(password, user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Identifiants invalides' }, { status: 401 })
    }

    const token = await createSession(user.id)

    return NextResponse.json(
      {
        user: {
          id:       user.id,
          email:    user.email,
          name:     user.name,
          role:     user.role,
          tenantId: user.tenantId,
        },
      },
      {
        status: 200,
        headers: { 'Set-Cookie': buildSessionCookie(token) },
      }
    )
  } catch (e) {
    console.error('[auth/login]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
