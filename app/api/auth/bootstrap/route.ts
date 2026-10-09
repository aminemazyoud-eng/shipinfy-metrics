import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/auth'
import { limited } from '@/lib/rate-limit'

// POST /api/auth/bootstrap — creates the first SUPER_ADMIN if no users exist
// Should only work once (when the DB is empty)
export async function POST(req: Request) {
  const tooMany = limited(req, 'bootstrap', 5, 60 * 60_000)
  if (tooMany) return tooMany
  try {
    const userCount = await prisma.user.count()
    if (userCount > 0) {
      return NextResponse.json({ error: 'Bootstrap already done' }, { status: 409 })
    }

    const body = await req.json()
    const { email, password, name } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'email et password requis' }, { status: 400 })
    }
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `Mot de passe minimum ${MIN_PASSWORD_LENGTH} caractères` }, { status: 400 })
    }

    const user = await prisma.user.create({
      data: {
        email:    email.toLowerCase().trim(),
        password: hashPassword(password),
        name:     name ?? 'Super Admin',
        role:     'SUPER_ADMIN',
        active:   true,
      },
    })

    return NextResponse.json({
      ok:    true,
      email: user.email,
      role:  user.role,
    }, { status: 201 })
  } catch (e) {
    console.error('[auth/bootstrap]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
