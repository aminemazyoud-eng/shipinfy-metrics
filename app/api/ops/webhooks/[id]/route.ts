import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { envUnavailable } from '@/lib/env'
import { checkEndpointUrl, newSecret, sealSecret, validateEvents } from '@/lib/ops-webhooks'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

// PATCH /api/ops/webhooks/:id { name?, url?, events?, active?, rotateSecret? } (ADMIN) — rotateSecret renvoie le nouveau secret UNE fois
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    const b = await req.json() as { name?: unknown; url?: unknown; events?: unknown; active?: unknown; rotateSecret?: unknown }
    const data: Record<string, unknown> = {}
    if (b.name !== undefined) { const n = typeof b.name === 'string' ? b.name.trim() : ''; if (!n || n.length > 80) return NextResponse.json({ error: 'Nom invalide' }, { status: 400 }); data.name = n }
    if (b.url !== undefined) { const e = await checkEndpointUrl(String(b.url)); if (e) return NextResponse.json({ error: e }, { status: 400 }); data.url = String(b.url) }
    if (b.events !== undefined) { const ev = validateEvents(b.events); if (typeof ev === 'string') return NextResponse.json({ error: ev }, { status: 400 }); data.events = ev.join(',') }
    if (b.active !== undefined) data.active = b.active === true
    let secret: string | undefined
    if (b.rotateSecret === true) { secret = newSecret(); data.secret = sealSecret(secret) }
    if (!Object.keys(data).length) return NextResponse.json({ error: 'Rien à modifier' }, { status: 400 })
    const r = await prisma.opsWebhookEndpoint.updateMany({ where: { id }, data })
    if (!r.count) return NextResponse.json({ error: 'Endpoint introuvable' }, { status: 404 })
    await audit(auth.session, 'webhook.update', 'webhook', id, { ...data, secret: secret ? '(rotation)' : undefined })
    return NextResponse.json({ ok: true, ...(secret ? { secret, note: 'Copiez ce secret maintenant : il ne sera plus affiché.' } : {}) })
  } catch (e) { const env = envUnavailable(e); return env ?? fail(e) }
}

// DELETE /api/ops/webhooks/:id (ADMIN) — supprime l'endpoint et son historique de livraisons
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    const [, n] = await prisma.$transaction([prisma.opsWebhookDelivery.deleteMany({ where: { endpointId: id } }), prisma.opsWebhookEndpoint.deleteMany({ where: { id } })])
    if (!n.count) return NextResponse.json({ error: 'Endpoint introuvable' }, { status: 404 })
    await audit(auth.session, 'webhook.delete', 'webhook', id)
    return NextResponse.json({ ok: true })
  } catch (e) { return fail(e) }
}
