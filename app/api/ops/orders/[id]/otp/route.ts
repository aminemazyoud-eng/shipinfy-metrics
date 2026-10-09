import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { verifyOtp, OTP_MAX_ATTEMPTS } from '@/lib/ops-otp'
import { envUnavailable } from '@/lib/env'

// Statuts où le livreur est chez/vers le client : seuls cas où le code de remise a un sens
const ELIGIBLE = ['IN_TRANSPORT', 'START_DELIVERY', 'DELIVERED']

const state = (o: { otpVerifiedAt: Date | null; otpVerifiedBy: string | null; otpAttempts: number }) =>
  ({ verifiedAt: o.otpVerifiedAt?.toISOString() ?? null, verifiedBy: o.otpVerifiedBy ?? null, attempts: o.otpAttempts, locked: !o.otpVerifiedAt && o.otpAttempts >= OTP_MAX_ATTEMPTS, maxAttempts: OTP_MAX_ATTEMPTS })

// GET /api/ops/orders/:id/otp — ÉTAT de la vérification uniquement (jamais le code). VIEWER+.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await opsAuth(req, 'VIEWER')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    const o = await prisma.opsOrder.findUnique({ where: { id }, select: { otpVerifiedAt: true, otpVerifiedBy: true, otpAttempts: true } })
    if (!o) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    return NextResponse.json(state(o))
  } catch (e) { return fail(e) }
}

// POST /api/ops/orders/:id/otp {code} — vérifie le code communiqué par le client. DISPATCHER+. Le code n'est jamais journalisé.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({})) as { code?: unknown }
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const o = await prisma.opsOrder.findUnique({ where: { id }, select: { id: true, status: true, hubCode: true, otpVerifiedAt: true, otpVerifiedBy: true, otpAttempts: true } })
    if (!o) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    if (!ELIGIBLE.includes(o.status)) return NextResponse.json({ error: 'Le code ne se vérifie qu\'une fois la commande en transport, en livraison ou livrée' }, { status: 409 })
    if (o.otpVerifiedAt) return NextResponse.json({ error: 'Code déjà vérifié', ...state(o) }, { status: 409 })
    if (o.otpAttempts >= OTP_MAX_ATTEMPTS) return NextResponse.json({ error: 'Vérification verrouillée : trop d\'essais', ...state(o) }, { status: 429 })
    if (!/^\d{4}$/.test(code)) return NextResponse.json({ error: 'Le code comporte 4 chiffres' }, { status: 400 })

    if (!verifyOtp(o.id, code)) {
      // Échec : incrément ATOMIQUE conditionné (deux requêtes parallèles ne peuvent pas dépasser le plafond)
      const r = await prisma.opsOrder.updateMany({ where: { id: o.id, otpVerifiedAt: null, otpAttempts: { lt: OTP_MAX_ATTEMPTS } }, data: { otpAttempts: { increment: 1 } } })
      const cur = await prisma.opsOrder.findUnique({ where: { id: o.id }, select: { otpVerifiedAt: true, otpVerifiedBy: true, otpAttempts: true } })
      const st = cur ? state(cur) : null
      await audit(auth.session, 'order.otp_verify', 'order', o.id, { ok: false, attempts: st?.attempts ?? null }, o.hubCode)
      if (r.count === 0) return NextResponse.json({ error: 'Vérification verrouillée ou déjà effectuée', ...(st ?? {}) }, { status: st?.locked ? 429 : 409 })
      return NextResponse.json({ error: st?.locked ? 'Code incorrect : vérification verrouillée' : 'Code incorrect', ...(st ?? {}) }, { status: st?.locked ? 429 : 422 })
    }

    // Succès : pose conditionnelle (une seule vérification gagne)
    const by = auth.session.name || auth.session.email || 'inconnu'
    const r = await prisma.opsOrder.updateMany({ where: { id: o.id, otpVerifiedAt: null, otpAttempts: { lt: OTP_MAX_ATTEMPTS } }, data: { otpVerifiedAt: new Date(), otpVerifiedBy: by } })
    const cur = await prisma.opsOrder.findUnique({ where: { id: o.id }, select: { otpVerifiedAt: true, otpVerifiedBy: true, otpAttempts: true } })
    if (r.count === 0) return NextResponse.json({ error: 'Vérification verrouillée ou déjà effectuée', ...(cur ? state(cur) : {}) }, { status: cur?.otpVerifiedAt ? 409 : 429 })
    await audit(auth.session, 'order.otp_verify', 'order', o.id, { ok: true }, o.hubCode)
    return NextResponse.json({ ok: true, ...(cur ? state(cur) : {}) })
  } catch (e) { return envUnavailable(e) ?? fail(e) }
}
