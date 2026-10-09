import { NextRequest, NextResponse } from 'next/server'
import { createHmac, randomBytes, randomInt } from 'crypto'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-guard'
import { requireEnv, envUnavailable } from '@/lib/env'
import { limited } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// POST /api/pointage/qr-generate  (session obligatoire)
// Body: { driverCode?: string, driverName?: string, role: 'LIVREUR' | 'PICKER' }
// Le livreur est identifié CÔTÉ SERVEUR : le code (ou le nom) doit correspondre à une fiche OpsDriver active.
// Jeton = base64url( "nom|ts|rôle|nonce|hmac" ) — HMAC-SHA256 avec QR_SECRET (aucun secret de repli).
export async function POST(req: NextRequest) {
  const auth = await requireSession(req)
  if ('error' in auth) return auth.error
  const lim = limited(req, 'qr-generate', 6, 60_000, auth.session.userId)
  if (lim) return lim
  try {
    const body = await req.json() as { driverCode?: string; driverName?: string; role?: string }
    const code = (body.driverCode ?? '').trim()
    const name = (body.driverName ?? '').trim()
    const role = body.role === 'PICKER' ? 'PICKER' : 'LIVREUR'
    if (!code && !name) return NextResponse.json({ error: 'driverCode ou driverName requis' }, { status: 400 })

    // fiche existante et active (comparaison insensible à la casse)
    const actives = await prisma.opsDriver.findMany({ where: { status: 'active' }, select: { code: true, firstName: true, lastName: true } })
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
    const driver = actives.find(d => code ? norm(d.code) === norm(code) : norm(`${d.firstName} ${d.lastName}`) === norm(name))
    if (!driver) return NextResponse.json({ error: 'Livreur inconnu ou inactif', code: 'DRIVER_NOT_FOUND' }, { status: 404 })
    const driverName = `${driver.firstName} ${driver.lastName}`.trim()
    if (driverName.includes('|')) return NextResponse.json({ error: 'Nom de livreur invalide' }, { status: 400 })

    const secret    = requireEnv('QR_SECRET')
    const timestamp = Date.now()
    const nonce     = randomBytes(8).toString('hex')
    const payload   = `${driverName}|${timestamp}|${role}|${nonce}`
    const hmac      = createHmac('sha256', secret).update(payload).digest('hex')
    const token     = Buffer.from(`${payload}|${hmac}`).toString('base64url')

    // PIN à 6 chiffres (CSPRNG) — renvoyé pour usage ultérieur, non vérifié côté serveur
    const pin = String(randomInt(100000, 1000000))

    const qrDataUrl = await QRCode.toDataURL(token)

    return NextResponse.json({
      token,
      pin,
      expiresAt: new Date(timestamp + 10_000).toISOString(),
      qrData:    token,
      qrDataUrl,
      driverName,
      driverCode: driver.code,
    })
  } catch (e) {
    const env = envUnavailable(e); if (env) return env
    console.error('[api/pointage/qr-generate]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
