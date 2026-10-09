import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { limited } from '@/lib/rate-limit'
import { envUnavailable } from '@/lib/env'
import { readTrackToken, toPublicView, OTP_STATUSES } from '@/lib/ops-tracking'
import { etaForOrder } from '@/lib/ops-eta'
import { otpCodeFor } from '@/lib/ops-otp'

const H = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' }

// GET /api/track/:token — suivi client PUBLIC (lien signé HMAC). Ne renvoie que le minimum : statut, créneau, étapes, prénom du livreur, ETA, code de remise.
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const lim = limited(req, 'track', 60, 60_000)
  if (lim) return lim
  try {
    const { token } = await ctx.params
    const orderId = readTrackToken(token)
    if (!orderId) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 403, headers: H })
    const o = await prisma.opsOrder.findUnique({
      where: { id: orderId },
      select: {
        reference: true, externalId: true, status: true, slotStart: true, slotEnd: true, slotLabel: true, createdAtSrc: true, deliveredAt: true, noShowAt: true, hubCode: true,
        events: { orderBy: { at: 'asc' }, select: { toStatus: true, at: true, source: true } }, driver: { select: { firstName: true } },
      },
    })
    if (!o) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404, headers: H })
    const [hub, rating] = await Promise.all([
      o.hubCode ? prisma.opsHub.findUnique({ where: { code: o.hubCode }, select: { name: true } }) : null,
      prisma.opsDeliveryRating.findUnique({ where: { orderId }, select: { score: true } }),
    ])
    const live = OTP_STATUSES.includes(o.status)
    let etaAt: string | null = null
    if (live) { try { etaAt = (await etaForOrder(orderId)).etaAt } catch { etaAt = null } } // l'ETA ne doit jamais bloquer le suivi
    const otpCode = live ? otpCodeFor(orderId) : null
    const view = toPublicView({ ...o, hubName: hub?.name ?? null, driverFirstName: o.driver?.firstName ?? null, rating: rating?.score ?? null }, { etaAt, otpCode })
    return NextResponse.json(view, { headers: H })
  } catch (err) {
    const env = envUnavailable(err); if (env) { env.headers.set('Cache-Control', 'private, no-store'); return env }
    console.error('[api/track]', err); return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: H })
  }
}
