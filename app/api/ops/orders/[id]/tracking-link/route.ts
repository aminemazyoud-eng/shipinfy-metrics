import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { envUnavailable } from '@/lib/env'
import { trackUrl } from '@/lib/ops-tracking'
import { normalizePhone } from '@/lib/ops-planning'

// GET /api/ops/orders/:id/tracking-link — lien de suivi client signé + lien WhatsApp prêt à envoyer (dispatch)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    const o = await prisma.opsOrder.findUnique({ where: { id }, select: { id: true, reference: true, externalId: true, slotEnd: true, customerPhone: true } })
    if (!o) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    const url = trackUrl(o.id, o.slotEnd)
    const phone = normalizePhone(o.customerPhone)
    const text = `Bonjour, suivez votre livraison Shipinfy (commande ${o.reference || o.externalId}) en direct : ${url}`
    const whatsappLink = `https://wa.me/${phone ? phone.replace('+', '') : ''}?text=${encodeURIComponent(text)}`
    return NextResponse.json({ url, whatsappLink, customerPhoneKnown: Boolean(phone) })
  } catch (e) { return envUnavailable(e) ?? fail(e) }
}
