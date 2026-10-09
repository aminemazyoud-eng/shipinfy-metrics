export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { limited } from '@/lib/rate-limit'
import { verifyPassword, needsRehash, hashPassword, burnPasswordCheck, createSession, buildSessionCookie, buildRoleCookie } from '@/lib/auth'

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 })
    }

    // Anti brute-force : 5 tentatives / 15 min par IP + email
    const tooMany = limited(req, 'login', 5, 15 * 60_000, String(email).toLowerCase().trim())
    if (tooMany) return tooMany

    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null
    const userAgent = req.headers.get('user-agent') ?? null

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

    if (!user || !user.active) {
      burnPasswordCheck(String(password)) // égalise le temps de réponse (utilisateur inconnu / inactif)
      // Log failed attempt if user exists
      if (user) {
        prisma.$executeRaw`
          INSERT INTO "LoginLog" ("id","userId","email","tenantId","ip","userAgent","status","createdAt")
          VALUES (gen_random_uuid()::text, ${user.id}, ${user.email}, ${user.tenantId ?? null}, ${ip}, ${userAgent}, 'failed', NOW())
        `.catch(() => {})
      }
      return NextResponse.json({ error: 'Identifiants invalides' }, { status: 401 })
    }

    const valid = verifyPassword(password, user.password)
    if (!valid) {
      prisma.$executeRaw`
        INSERT INTO "LoginLog" ("id","userId","email","tenantId","ip","userAgent","status","createdAt")
        VALUES (gen_random_uuid()::text, ${user.id}, ${user.email}, ${user.tenantId ?? null}, ${ip}, ${userAgent}, 'failed', NOW())
      `.catch(() => {})
      return NextResponse.json({ error: 'Identifiants invalides' }, { status: 401 })
    }

    // Re-hachage transparent des anciens hash (100000 itérations) vers le format courant
    if (needsRehash(user.password)) {
      await prisma.user.update({ where: { id: user.id }, data: { password: hashPassword(String(password)) } }).catch(() => {})
    }

    const token = await createSession(user.id)

    // Log successful login (non-blocking)
    prisma.$executeRaw`
      INSERT INTO "LoginLog" ("id","userId","email","tenantId","ip","userAgent","status","createdAt")
      VALUES (gen_random_uuid()::text, ${user.id}, ${user.email}, ${user.tenantId ?? null}, ${ip}, ${userAgent}, 'success', NOW())
    `.catch(() => {})

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
