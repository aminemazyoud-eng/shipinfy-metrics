import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, createSession, buildSessionCookie, buildRoleCookie } from '@/lib/auth'

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

    const response = NextResponse.json(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId } },
      { status: 200 }
    )
    response.headers.set('Set-Cookie', buildSessionCookie(token))
    response.headers.append('Set-Cookie', buildRoleCookie(user.role))
    return response
  } catch (e) {
    console.error('[auth/login]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
