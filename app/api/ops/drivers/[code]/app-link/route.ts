import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { envUnavailable } from '@/lib/env'
import { appUrl, normalizePhone } from '@/lib/ops-planning'
import { makeDriverToken } from '@/lib/ops-driver-token'

export const dynamic = 'force-dynamic'

const SEL = { code: true, firstName: true, phone: true, tokenVersion: true, hub: { select: { code: true } } } as const

// POST /api/ops/drivers/:code/app-link  { revoke?: true } — lien personnel de l'application livreur (jeton signé, 30 jours). DISPATCHER+.
// revoke:true incrémente tokenVersion : TOUS les liens déjà émis pour ce livreur cessent de fonctionner, un nouveau lien est renvoyé.
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { code } = await ctx.params
    const body = await req.json().catch(() => ({})) as { revoke?: unknown }
    const revoke = body.revoke === true
    let d = await prisma.opsDriver.findUnique({ where: { code }, select: SEL })
    if (!d) return NextResponse.json({ error: 'Livreur inconnu' }, { status: 404 })
    if (revoke) d = await prisma.opsDriver.update({ where: { code }, data: { tokenVersion: { increment: 1 } }, select: SEL })
    const url = `${appUrl()}/livreur?t=${makeDriverToken(d.code, d.tokenVersion)}`
    const phone = normalizePhone(d.phone)
    const text = `Bonjour ${d.firstName}, voici le lien de votre application livreur Shipinfy. Ouvrez-le sur votre téléphone puis ajoutez-le à l'écran d'accueil : ${url}`
    const whatsappLink = `https://wa.me/${phone ? phone.replace('+', '') : ''}?text=${encodeURIComponent(text)}`
    await audit(auth.session, revoke ? 'driver.app_link_revoke' : 'driver.app_link', 'driver', d.code, { revoked: revoke, tokenVersion: d.tokenVersion }, d.hub?.code)
    return NextResponse.json({ url, whatsappLink, phoneKnown: !!phone, revoked: revoke }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return envUnavailable(e) ?? fail(e) }
}
