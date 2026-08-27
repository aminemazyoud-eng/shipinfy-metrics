import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import QRCode from 'qrcode'

export const runtime = 'nodejs'

// POST /api/pointage/qr-generate
// Body: { driverName: string, role: 'LIVREUR' | 'PICKER' }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { driverName?: string; role?: string }
    const driverName = (body.driverName ?? '').trim()
    const role = body.role === 'PICKER' ? 'PICKER' : 'LIVREUR'

    if (!driverName) {
      return NextResponse.json({ error: 'driverName requis' }, { status: 400 })
    }

    const timestamp = Date.now()
    const payload   = `${driverName}|${timestamp}|${role}`
    const secret    = process.env.QR_SECRET ?? 'shipinfy-dev-secret'
    const hmac      = createHmac('sha256', secret).update(payload).digest('hex')
    const token     = Buffer.from(`${payload}|${hmac}`).toString('base64url')

    // 6-digit numeric PIN — returned for future use (not verified server-side yet)
    const pin = String(Math.floor(100000 + Math.random() * 900000))

    const qrDataUrl = await QRCode.toDataURL(token)

    return NextResponse.json({
      token,
      pin,
      expiresAt: new Date(timestamp + 10_000).toISOString(),
      qrData:    token,
      qrDataUrl,
    })
  } catch (e) {
    console.error('[api/pointage/qr-generate]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
