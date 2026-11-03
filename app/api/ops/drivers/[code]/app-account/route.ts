import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { hashPassword } from '@/lib/auth'
import { generateDriverPassword, validDriverPassword, DRIVER_PW_MIN } from '@/lib/ops-driver-account'

export const dynamic = 'force-dynamic'

// GET    /api/ops/drivers/:code/app-account → { hasAccount, lastLoginAt }
// POST   /api/ops/drivers/:code/app-account { password? } → crée ou réinitialise le compte ; sans `password`, un mot de passe est généré.
//        Le mot de passe en clair n'est renvoyé QU'UNE FOIS (ici) ; tous les anciens jetons du livreur sont révoqués (tokenVersion + 1).
// DELETE /api/ops/drivers/:code/app-account → supprime le compte (le livreur ne peut plus se connecter) ; jetons révoqués.
// Rôle minimal : DISPATCHER. Le compte livreur est séparé des utilisateurs du back-office.
type Ctx = { params: Promise<{ code: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { code } = await params
    const d = await prisma.opsDriver.findUnique({ where: { code }, select: { appPasswordHash: true, appLoginAt: true } })
    if (!d) return NextResponse.json({ error: 'Livreur introuvable' }, { status: 404 })
    return NextResponse.json({ hasAccount: !!d.appPasswordHash, lastLoginAt: d.appLoginAt })
  } catch (e) { return fail(e) }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { code } = await params
    const body = await req.json().catch(() => ({})) as { password?: unknown }
    if (body.password !== undefined && !validDriverPassword(body.password)) return NextResponse.json({ error: `Mot de passe : ${DRIVER_PW_MIN} caractères minimum` }, { status: 400 })
    const existing = await prisma.opsDriver.findUnique({ where: { code }, select: { appPasswordHash: true, hub: { select: { code: true } } } })
    if (!existing) return NextResponse.json({ error: 'Livreur introuvable' }, { status: 404 })
    const password = (body.password as string | undefined) ?? generateDriverPassword()
    await prisma.opsDriver.update({ where: { code }, data: { appPasswordHash: hashPassword(password), tokenVersion: { increment: 1 } } })
    await audit(auth.session, existing.appPasswordHash ? 'driver.account_reset' : 'driver.account_create', 'driver', code, { generated: body.password === undefined }, existing.hub?.code)
    return NextResponse.json({ ok: true, login: code, password, created: !existing.appPasswordHash }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fail(e) }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await opsAuth(req, 'DISPATCHER')
  if ('error' in auth) return auth.error
  try {
    const { code } = await params
    const r = await prisma.opsDriver.updateMany({ where: { code }, data: { appPasswordHash: null, tokenVersion: { increment: 1 } } })
    if (!r.count) return NextResponse.json({ error: 'Livreur introuvable' }, { status: 404 })
    await audit(auth.session, 'driver.account_delete', 'driver', code)
    return NextResponse.json({ ok: true })
  } catch (e) { return fail(e) }
}
