import { NextRequest, NextResponse } from 'next/server'
import { guardApiKey } from '@/lib/api-keys' // garde : verifyApiKey (SHA-256 + timingSafeEqual) — route publique pour proxy.ts, protégée par clé API
import { envUnavailable } from '@/lib/env'
import { limited } from '@/lib/rate-limit'
import { validateIngest, ingestOrder, readJsonLimited, getOrderView, ingestSource } from '@/lib/ops-ingest'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ externalId: string }> }

// GET /api/v1/orders/:externalId — relecture du statut (et des événements) d'une commande poussée.
export async function GET(req: NextRequest, ctx: Ctx) {
  const lim = limited(req, 'v1-orders-ip', 600, 60_000)
  if (lim) return lim
  try {
    const g = guardApiKey(req, 'INGEST_API_KEYS')
    if ('error' in g) return g.error
    const lim2 = limited(req, 'v1-orders-key', 300, 60_000, g.name)
    if (lim2) return lim2
    const { externalId } = await ctx.params
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(externalId)) return NextResponse.json({ error: 'externalId invalide' }, { status: 400 })
    const order = await getOrderView(ingestSource(), externalId)
    if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    return NextResponse.json({ order }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    const env = envUnavailable(e); if (env) return env
    console.error('[api/v1/orders/:id]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// PUT /api/v1/orders/:externalId — crée ou met à jour (champs présents uniquement) ; { "cancel": true } annule. Jamais de rétrogradation de statut.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const lim = limited(req, 'v1-orders-ip', 600, 60_000)
  if (lim) return lim
  try {
    const g = guardApiKey(req, 'INGEST_API_KEYS')
    if ('error' in g) return g.error
    const lim2 = limited(req, 'v1-orders-key', 300, 60_000, g.name)
    if (lim2) return lim2
    const { externalId } = await ctx.params
    const body = await readJsonLimited(req)
    if ('error' in body) return NextResponse.json({ error: body.error }, { status: body.status })
    const v = validateIngest(body.json, 'update', externalId)
    if ('errors' in v) return NextResponse.json({ error: 'Validation échouée', details: v.errors }, { status: 422 })
    const r = await ingestOrder(v.value, { update: true, keyName: g.name })
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ created: r.created, order: r.order }, { status: r.status })
  } catch (e) {
    const env = envUnavailable(e); if (env) return env
    console.error('[api/v1/orders/:id]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
