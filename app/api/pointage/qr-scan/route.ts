import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { isUsed, markUsed } from '@/lib/qr-blacklist'

export const runtime = 'nodejs'

// POST /api/pointage/qr-scan
// Body: { token: string, scannedBy: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { token?: string; scannedBy?: string }
    const token     = (body.token ?? '').trim()
    const scannedBy  = (body.scannedBy ?? '').trim() || null

    if (!token) {
      return NextResponse.json({ error: 'TOKEN_INVALID' }, { status: 400 })
    }

    // Decode base64url → "driverName|timestamp|role|hmac"
    let decoded: string
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8')
    } catch {
      return NextResponse.json({ error: 'TOKEN_INVALID' }, { status: 400 })
    }

    const parts = decoded.split('|')
    if (parts.length !== 4) {
      return NextResponse.json({ error: 'TOKEN_INVALID' }, { status: 400 })
    }
    const [driverName, timestampStr, role, hmac] = parts

    // Recompute HMAC over "driverName|timestamp|role"
    const secret   = process.env.QR_SECRET ?? 'shipinfy-dev-secret'
    const expected = createHmac('sha256', secret).update(`${driverName}|${timestampStr}|${role}`).digest('hex')

    const a = Buffer.from(hmac)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'TOKEN_INVALID' }, { status: 400 })
    }

    // Expiry — 10s window
    const ts = Number(timestampStr)
    if (!Number.isFinite(ts) || Date.now() - ts > 10_000) {
      return NextResponse.json({ error: 'TOKEN_EXPIRED' }, { status: 400 })
    }

    // Single-use
    if (isUsed(token)) {
      return NextResponse.json({ error: 'TOKEN_USED' }, { status: 409 })
    }
    markUsed(token)

    // Today at UTC midnight
    const now = new Date()
    const dateKey = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const normalizedRole = role === 'PICKER' ? 'PICKER' : 'LIVREUR'

    const existing = await prisma.driverAttendance.findUnique({
      where: { driverName_date: { driverName, date: dateKey } },
    })

    let action: 'check-in' | 'check-out' | 'already-complete'
    let record

    if (!existing || !existing.checkIn) {
      action = 'check-in'
      record = await prisma.driverAttendance.upsert({
        where:  { driverName_date: { driverName, date: dateKey } },
        create: {
          driverName,
          date:      dateKey,
          checkIn:   now,
          status:    'present',
          role:      normalizedRole,
          scannedBy,
          qrScanId:  token.slice(0, 32),
        },
        update: {
          checkIn:   now,
          status:    'present',
          role:      normalizedRole,
          scannedBy,
          qrScanId:  token.slice(0, 32),
        },
      })
    } else if (!existing.checkOut) {
      action = 'check-out'
      record = await prisma.driverAttendance.update({
        where: { id: existing.id },
        data:  { checkOut: now, scannedBy: scannedBy ?? existing.scannedBy },
      })
    } else {
      action = 'already-complete'
      return NextResponse.json({
        success:    false,
        driverName,
        role:       normalizedRole,
        action,
        message:    'Check-in et check-out déjà enregistrés pour aujourd\'hui',
        timestamp:  now.toISOString(),
      })
    }

    return NextResponse.json({
      success:    true,
      driverName,
      role:       normalizedRole,
      action,
      timestamp:  now.toISOString(),
      recordId:   record?.id,
    })
  } catch (e) {
    console.error('[api/pointage/qr-scan]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
