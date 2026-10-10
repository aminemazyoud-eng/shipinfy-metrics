import { NextRequest, NextResponse } from 'next/server'
import { guardApiKey } from '@/lib/api-keys' // garde : verifyApiKey (SHA-256 + timingSafeEqual) — route publique pour proxy.ts, protégée par clé API
import { envUnavailable } from '@/lib/env'
import { limited } from '@/lib/rate-limit'
import { validateIngest, ingestOrder, readJsonLimited } from '@/lib/ops-ingest'

export const runtime = 'nodejs'

// POST /api/v1/orders — ingestion d'une commande par un système externe. En-tête x-api-key (INGEST_API_KEYS).
// 201 créée · 200 déjà connue (idempotent sur source+externalId) · 400/413/422 validation · 401 clé · 429 limite · 503 clés non configurées.
export async function POST(req: NextRequest) {
  const lim = limited(req, 'v1-orders-ip', 600, 60_000)
  if (lim) return lim
  try {
    const g = guardApiKey(req, 'INGEST_API_KEYS')
    if ('error' in g) return g.error
    const lim2 = limited(req, 'v1-orders-key', 300, 60_000, g.name)
    if (lim2) return lim2
    const body = await readJsonLimited(req)
    if ('error' in body) return NextResponse.json({ error: body.error }, { status: body.status })
    const v = validateIngest(body.json, 'create')
    if ('errors' in v) return NextResponse.json({ error: 'Validation échouée', details: v.errors }, { status: 422 })
    const r = await ingestOrder(v.value, { update: false, keyName: g.name })
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ created: r.created, order: r.order }, { status: r.status })
  } catch (e) {
    const env = envUnavailable(e); if (env) return env
    console.error('[api/v1/orders]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
