import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { limited } from '@/lib/rate-limit'
import { envUnavailable } from '@/lib/env'
import { readTrackToken, cleanComment } from '@/lib/ops-tracking'

const H = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' }

// POST /api/track/:token/rating {score 1-5, comment?} — une seule note par commande, uniquement une fois livrée. Public (lien signé).
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const lim = limited(req, 'track-rating', 60, 60_000)
  if (lim) return lim
  try {
    const { token } = await ctx.params
    const orderId = readTrackToken(token)
    if (!orderId) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 403, headers: H })
    const b = await req.json().catch(() => null) as { score?: unknown; comment?: unknown } | null
    const score = Number(b?.score)
    if (!Number.isInteger(score) || score < 1 || score > 5) return NextResponse.json({ error: 'Note invalide (1 à 5)' }, { status: 400, headers: H })
    const o = await prisma.opsOrder.findUnique({ where: { id: orderId }, select: { status: true } })
    if (!o) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404, headers: H })
    if (o.status !== 'DELIVERED') return NextResponse.json({ error: 'La commande doit être livrée pour être notée' }, { status: 409, headers: H })
    try { await prisma.opsDeliveryRating.create({ data: { orderId, score, comment: cleanComment(b?.comment) } }) }
    catch { return NextResponse.json({ error: 'Cette livraison a déjà été notée' }, { status: 409, headers: H }) } // unicité orderId
    return NextResponse.json({ ok: true, score }, { status: 201, headers: H })
  } catch (err) {
    const env = envUnavailable(err); if (env) return env
    console.error('[api/track/rating]'); return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: H }) // rien de personnel journalisé
  }
}
