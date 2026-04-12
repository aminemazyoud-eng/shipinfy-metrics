import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, hashPassword, roleAtLeast } from '@/lib/auth'
import { transporter } from '@/lib/mailer'

export const runtime = 'nodejs'

// GET /api/admin/users?tenantId=xxx  — list users (SUPER_ADMIN only)
export async function GET(req: Request) {
  try {
    const session = await getSession(req)
    if (!session || !roleAtLeast(session.role, 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const users = await prisma.user.findMany({
      where: tenantId ? { tenantId } : {},
      select: { id: true, email: true, name: true, role: true, tenantId: true, active: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(users)
  } catch (e) {
    console.error('[admin/users GET]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

// POST /api/admin/users — create user (SUPER_ADMIN only)
export async function POST(req: Request) {
  try {
    const session = await getSession(req)
    if (!session || !roleAtLeast(session.role, 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { email, password, name, role, tenantId } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'email et password requis' }, { status: 400 })
    }
    if ((password as string).length < 6) {
      return NextResponse.json({ error: 'Mot de passe minimum 6 caractères' }, { status: 400 })
    }

    const { ROLES } = await import('@/lib/auth')
    const userRole = (ROLES as readonly string[]).includes(role) ? role : 'VIEWER'

    const cleanEmail = (email as string).toLowerCase().trim()

    const user = await prisma.user.create({
      data: {
        email:    cleanEmail,
        password: hashPassword(password),
        name:     name ?? null,
        role:     userRole,
        tenantId: tenantId ?? null,
        active:   true,
      },
      select: { id: true, email: true, name: true, role: true, tenantId: true, active: true, createdAt: true },
    })

    // Send welcome email with credentials (non-blocking)
    const loginUrl = process.env.NEXTAUTH_URL ?? 'https://metrics.mediflows.shop'
    transporter.sendMail({
      from:    process.env.SMTP_FROM ?? 'Shipinfy Metrics <no-reply@shipinfy.com>',
      to:      cleanEmail,
      subject: '🚀 Votre accès Shipinfy Metrics',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px">
          <div style="text-align:center;margin-bottom:24px">
            <h1 style="color:#1d4ed8;font-size:22px;font-weight:900;margin:0">SHIPINFY</h1>
            <p style="color:#94a3b8;font-size:13px;margin:4px 0 0">Metrics & Analytics</p>
          </div>
          <div style="background:#fff;border-radius:10px;padding:24px;border:1px solid #e2e8f0">
            <p style="color:#1e293b;font-size:15px;margin:0 0 16px">
              Bonjour ${name ?? cleanEmail},
            </p>
            <p style="color:#475569;font-size:14px;margin:0 0 20px">
              Votre compte a été créé sur <strong>Shipinfy Metrics</strong>. Voici vos identifiants de connexion :
            </p>
            <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin-bottom:20px">
              <p style="margin:0 0 8px;font-size:13px;color:#64748b">Email</p>
              <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#1e293b">${cleanEmail}</p>
              <p style="margin:0 0 8px;font-size:13px;color:#64748b">Mot de passe</p>
              <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#1e293b;letter-spacing:1px">${password}</p>
              <p style="margin:0 0 8px;font-size:13px;color:#64748b">Rôle</p>
              <p style="margin:0;font-size:15px;font-weight:700;color:#1d4ed8">${userRole}</p>
            </div>
            <a href="${loginUrl}/login" style="display:block;text-align:center;background:#2563eb;color:#fff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">
              Se connecter →
            </a>
          </div>
          <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:16px">
            Changez votre mot de passe après votre première connexion.
          </p>
        </div>
      `,
    }).catch(err => console.error('[admin/users] email send failed:', err))

    return NextResponse.json(user, { status: 201 })
  } catch (e: unknown) {
    const msg = (e as Error).message ?? ''
    if (msg.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Email déjà utilisé' }, { status: 409 })
    }
    console.error('[admin/users POST]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
