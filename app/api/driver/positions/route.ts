import { NextRequest, NextResponse } from 'next/server'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { validLatLng } from '@/lib/geo'

export const dynamic = 'force-dynamic'

const MAX_POSITIONS_PER_CALL = 200
const MAX_AGE_MS = 48 * 3_600_000
const FUTURE_MS = 5 * 60_000

// POST /api/driver/positions { points: [{ lat, lng, accuracy?, speed?, at }], tourId? } — suivi GPS (lots de 200 points max, rejoués sans doublon).
export async function POST(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const { limited } = await import('@/lib/rate-limit')
    const l = limited(req, 'driver-pos', 30, 60_000, d.code)
    if (l) return l
    const { prisma } = await import('@/lib/prisma')
    const b = await req.json().catch(() => null) as { points?: unknown; tourId?: unknown } | null
    if (!b || !Array.isArray(b.points)) return driverJson({ error: 'points requis', code: 'BAD_REQUEST' }, 400)
    if (b.points.length > MAX_POSITIONS_PER_CALL) return driverJson({ error: `${MAX_POSITIONS_PER_CALL} points maximum par envoi`, code: 'TOO_MANY' }, 413)
    const now = Date.now()
    const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null)
    const clean: { lat: number; lng: number; accuracy: number | null; speed: number | null; at: Date }[] = []
    for (const raw of b.points) {
      const p = raw as Record<string, unknown> | null
      if (!p || !validLatLng(p.lat, p.lng)) continue
      const t = typeof p.at === 'string' || typeof p.at === 'number' ? new Date(p.at).getTime() : NaN
      if (!Number.isFinite(t) || t > now + FUTURE_MS || t < now - MAX_AGE_MS) continue
      clean.push({ lat: p.lat as number, lng: p.lng as number, accuracy: num(p.accuracy, 100_000), speed: num(p.speed, 200), at: new Date(t) })
    }
    // la tournée n'est retenue que si elle appartient bien à ce livreur
    let tourId: string | null = null
    if (typeof b.tourId === 'string' && b.tourId.length <= 64) {
      const t = await prisma.opsTour.findFirst({ where: { id: b.tourId, driverCode: d.code }, select: { id: true } })
      tourId = t?.id ?? null
    }
    // pas de doublon si le téléphone rejoue un lot dont la réponse s'est perdue
    let fresh = clean
    if (clean.length) {
      const known = await prisma.opsDriverPosition.findMany({ where: { driverCode: d.code, at: { in: clean.map(c => c.at) } }, select: { at: true } })
      const seen = new Set(known.map(k => k.at.getTime()))
      fresh = clean.filter(c => !seen.has(c.at.getTime()))
    }
    if (fresh.length) await prisma.opsDriverPosition.createMany({ data: fresh.map(c => ({ ...c, driverCode: d.code, tourId })) })
    return driverJson({ saved: fresh.length, ignored: b.points.length - fresh.length })
  } catch (e) { console.error('[api/driver/positions]', e); return driverJson({ error: 'Erreur serveur' }, 500) }
}
