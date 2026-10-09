import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-guard'
import { requireEnv, envUnavailable } from '@/lib/env'
import { limited } from '@/lib/rate-limit'
import { isUsed, markUsed } from '@/lib/qr-blacklist'
import { localToday, attendanceKeyTz } from '@/lib/tz'

export const runtime = 'nodejs'

const MIN_WORK_MINUTES = 30            // pas de check-out avant 30 min de présence
const NONCE_RETENTION_MS = 24 * 3_600_000

// POST /api/pointage/qr-scan  (session DISPATCHER minimum)
// Body: { token: string, override?: boolean } — `scannedBy` est TOUJOURS le nom de la session, jamais celui du body.
export async function POST(req: NextRequest) {
  const auth = await requireSession(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  const lim = limited(req, 'qr-scan', 30, 60_000, auth.session.userId)
  if (lim) return lim
  try {
    const body = await req.json() as { token?: string; override?: boolean }
    const token     = (body.token ?? '').trim()
    const scannedBy = auth.session.name || auth.session.email
    const override  = body.override === true

    if (!token) return NextResponse.json({ error: 'TOKEN_INVALID' }, { status: 400 })

    // base64url → "driverName|timestamp|role|nonce|hmac"
    let decoded: string
    try { decoded = Buffer.from(token, 'base64url').toString('utf8') } catch { return NextResponse.json({ error: 'TOKEN_INVALID' }, { status: 400 }) }
    const parts = decoded.split('|')
    if (parts.length !== 5) return NextResponse.json({ error: 'TOKEN_INVALID' }, { status: 400 })
    const [driverName, timestampStr, role, nonce, hmac] = parts
    if (!/^[0-9a-f]{16}$/.test(nonce)) return NextResponse.json({ error: 'TOKEN_INVALID' }, { status: 400 })

    const secret   = requireEnv('QR_SECRET')
    const expected = createHmac('sha256', secret).update(`${driverName}|${timestampStr}|${role}|${nonce}`).digest('hex')
    const a = Buffer.from(hmac), b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: 'TOKEN_INVALID' }, { status: 400 })

    // Fenêtre BILATÉRALE : un ts dans le futur est refusé comme un ts périmé
    const ts = Number(timestampStr)
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10_000) return NextResponse.json({ error: 'TOKEN_EXPIRED' }, { status: 400 })

    // Anti-rejeu : cache mémoire (1re ligne) puis insertion en base (clé primaire = nonce → survit aux redémarrages / multi-réplica)
    if (isUsed(nonce)) return NextResponse.json({ error: 'TOKEN_REPLAYED' }, { status: 409 })
    // SQL direct (INSERT ... ON CONFLICT) : 0 ligne insérée = nonce déjà consommé = rejeu (équivalent d'une violation P2002)
    const inserted = await prisma.$executeRaw`INSERT INTO "QrScanNonce" ("nonce", "driverName") VALUES (${nonce}, ${driverName}) ON CONFLICT ("nonce") DO NOTHING`
    if (inserted === 0) { markUsed(nonce); return NextResponse.json({ error: 'TOKEN_REPLAYED' }, { status: 409 }) }
    markUsed(nonce)
    // purge opportuniste (best-effort) des nonces de plus de 24 h
    prisma.$executeRaw`DELETE FROM "QrScanNonce" WHERE "usedAt" < ${new Date(Date.now() - NONCE_RETENTION_MS)}`.catch(() => {})

    // Clé du jour = jour LOCAL (Africa/Casablanca), même clé que ops-attendance
    const now = new Date()
    const dateKey = attendanceKeyTz(localToday(now.getTime()))
    const normalizedRole = role === 'PICKER' ? 'PICKER' : 'LIVREUR'

    const existing = await prisma.driverAttendance.findUnique({ where: { driverName_date: { driverName, date: dateKey } } })

    // Ne pas écraser un statut saisi manuellement (absent / congé) sans confirmation explicite
    if (existing && !existing.checkIn && (existing.status === 'absent' || existing.status === 'leave') && !override) {
      return NextResponse.json({ error: 'STATUS_CONFLICT', message: `Statut « ${existing.status} » déjà saisi pour aujourd'hui — renvoyez avec override:true pour le remplacer`, status: existing.status }, { status: 409 })
    }

    let action: 'check-in' | 'check-out'
    let record
    if (!existing || !existing.checkIn) {
      action = 'check-in'
      record = await prisma.driverAttendance.upsert({
        where:  { driverName_date: { driverName, date: dateKey } },
        create: { driverName, date: dateKey, checkIn: now, status: 'present', role: normalizedRole, scannedBy, qrScanId: nonce },
        update: { checkIn: now, status: 'present', role: normalizedRole, scannedBy, qrScanId: nonce },
      })
    } else if (!existing.checkOut) {
      const elapsedMin = (now.getTime() - existing.checkIn.getTime()) / 60_000
      if (elapsedMin < MIN_WORK_MINUTES) {
        const reste = Math.ceil(MIN_WORK_MINUTES - elapsedMin)
        return NextResponse.json({ error: 'MIN_WORK_TIME', message: `Check-out impossible : ${MIN_WORK_MINUTES} min de présence minimum (encore ${reste} min)`, remainingMinutes: reste }, { status: 409 })
      }
      action = 'check-out'
      record = await prisma.driverAttendance.update({ where: { id: existing.id }, data: { checkOut: now, scannedBy } })
    } else {
      return NextResponse.json({
        success: false, driverName, role: normalizedRole, action: 'already-complete',
        message: 'Check-in et check-out déjà enregistrés pour aujourd\'hui', timestamp: now.toISOString(),
      })
    }

    return NextResponse.json({ success: true, driverName, role: normalizedRole, action, timestamp: now.toISOString(), recordId: record?.id })
  } catch (e) {
    const env = envUnavailable(e); if (env) return env
    console.error('[api/pointage/qr-scan]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
