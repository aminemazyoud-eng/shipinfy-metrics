import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { envUnavailable } from '@/lib/env'
import { checkEndpointUrl, newSecret, sealSecret, validateEvents, WEBHOOK_EVENTS } from '@/lib/ops-webhooks'

export const runtime = 'nodejs'

// GET /api/ops/webhooks?endpointId&status — endpoints (sans secret) + dernières livraisons (ADMIN)
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const sp = new URL(req.url).searchParams
    const endpointId = sp.get('endpointId') || undefined
    const status = ['PENDING', 'OK', 'FAILED'].includes(sp.get('status') ?? '') ? sp.get('status')! : undefined
    const [endpoints, groups, deliveries, cursor] = await Promise.all([
      prisma.opsWebhookEndpoint.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, url: true, events: true, active: true, createdAt: true } }),
      prisma.opsWebhookDelivery.groupBy({ by: ['endpointId', 'status'], _count: { _all: true } }),
      prisma.opsWebhookDelivery.findMany({
        where: { ...(endpointId ? { endpointId } : {}), ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 100,
        select: { id: true, endpointId: true, event: true, status: true, attempts: true, nextAt: true, lastError: true, createdAt: true, deliveredAt: true },
      }),
      prisma.opsCostParam.findUnique({ where: { key: 'webhook.cursor' } }),
    ])
    const stats = new Map<string, Record<string, number>>()
    for (const g of groups) stats.set(g.endpointId, { ...(stats.get(g.endpointId) ?? {}), [g.status]: g._count._all })
    return NextResponse.json({
      endpoints: endpoints.map(e => ({ ...e, stats: { PENDING: 0, OK: 0, FAILED: 0, ...(stats.get(e.id) ?? {}) } })),
      deliveries, events: WEBHOOK_EVENTS, cursorAt: cursor ? new Date(cursor.value).toISOString() : null,
      keyConfigured: !!process.env.WEBHOOK_SECRET_KEY && process.env.WEBHOOK_SECRET_KEY.length >= 16,
    })
  } catch (e) { return fail(e) }
}

// POST /api/ops/webhooks { name, url, events: string[] } — crée un endpoint ; le secret n'est renvoyé QU'ICI (ADMIN)
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as { name?: unknown; url?: unknown; events?: unknown }
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name || name.length > 80) return NextResponse.json({ error: 'Nom requis (≤ 80 caractères)' }, { status: 400 })
    const urlErr = await checkEndpointUrl(String(b.url ?? ''))
    if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 })
    const events = validateEvents(b.events ?? ['*'])
    if (typeof events === 'string') return NextResponse.json({ error: events }, { status: 400 })
    if ((await prisma.opsWebhookEndpoint.count()) >= 20) return NextResponse.json({ error: '20 endpoints maximum' }, { status: 400 })
    const secret = newSecret()
    const ep = await prisma.opsWebhookEndpoint.create({ data: { name, url: String(b.url), secret: sealSecret(secret), events: events.join(',') }, select: { id: true } })
    await audit(auth.session, 'webhook.create', 'webhook', ep.id, { name, url: String(b.url), events })
    return NextResponse.json({ ok: true, id: ep.id, secret, note: 'Copiez ce secret maintenant : il ne sera plus affiché.' })
  } catch (e) { const env = envUnavailable(e); return env ?? fail(e) }
}
