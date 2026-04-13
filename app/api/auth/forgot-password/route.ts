export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { transporter } from '@/lib/mailer'

export async function POST(req: Request) {
  try {
    const { email } = await req.json()

    if (!email) {
      return NextResponse.json({ ok: true }) // Ne pas révéler si l'email existe
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

    if (user && user.active) {
      const token = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 heure

      await prisma.$executeRaw`
        INSERT INTO "PasswordReset" ("id", "userId", "token", "expiresAt", "createdAt")
        VALUES (gen_random_uuid()::text, ${user.id}, ${token}, ${expiresAt}, NOW())
      `

      const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'
      const resetLink = `${baseUrl}/login?reset=${token}`

      transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@shipinfy.com',
        to: user.email,
        subject: 'Réinitialisation de votre mot de passe — Shipinfy',
        html: `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"></head>
          <body style="font-family: Arial, sans-serif; background: #f8fafc; padding: 40px 20px;">
            <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #2563eb; font-size: 22px; margin: 0;">SHIPINFY Metrics</h1>
                <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Réinitialisation du mot de passe</p>
              </div>
              <p style="color: #374151; font-size: 14px;">Bonjour ${user.name ?? user.email},</p>
              <p style="color: #374151; font-size: 14px;">
                Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
              </p>
              <div style="text-align: center; margin: 28px 0;">
                <a href="${resetLink}"
                   style="display: inline-block; background: #2563eb; color: white; text-decoration: none;
                          padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                  Réinitialiser mon mot de passe
                </a>
              </div>
              <p style="color: #94a3b8; font-size: 12px; text-align: center;">
                Ce lien est valable pendant <strong>1 heure</strong>.<br>
                Si vous n'avez pas fait cette demande, ignorez cet email.
              </p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
              <p style="color: #cbd5e1; font-size: 11px; text-align: center;">
                Shipinfy Metrics — Accès sécurisé
              </p>
            </div>
          </body>
          </html>
        `,
      }).catch(err => console.error('[forgot-password] email error:', err))
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[forgot-password]', e)
    return NextResponse.json({ ok: true }) // Toujours répondre ok
  }
}
