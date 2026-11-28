import { NextRequest, NextResponse } from 'next/server'
import { guardApiKey } from '@/lib/api-keys' // garde : verifyApiKey (SHA-256 + timingSafeEqual) — route publique pour proxy.ts, protégée par clé API
import { envUnavailable } from '@/lib/env'
import { limited } from '@/lib/rate-limit'
import { MAX_UPLOAD_BYTES } from '@/lib/xlsx-import'
import { runImport } from '@/lib/ops-import-run'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// POST /api/v1/import — RÉCEPTION AUTOMATIQUE de l'export Shipinfy (scénario B), prévue toutes les 5 minutes. En-tête x-api-key (INGEST_API_KEYS).
//   Corps : soit multipart/form-data (champ « file »), soit le fichier brut (Content-Type: text/csv ou application/octet-stream) avec en-tête X-Filename: export.csv|xlsx.
//   ?dryRun=1 : analyse seulement, rien n'est enregistré.
//   Idempotent : on peut renvoyer le même fichier (export complet à chaque fois) — seules les commandes nouvelles ou modifiées sont écrites.
//   200 OK (résumé : inserted / replaced / unchanged) · 400 · 401 clé · 409 import déjà en cours · 413 trop gros (10 Mo) · 422 fichier/colonnes invalides · 429 limite · 503 clés non configurées.
export async function POST(req: NextRequest) {
  const lim = limited(req, 'v1-import-ip', 120, 60_000)
  if (lim) return lim
  try {
    const g = guardApiKey(req, 'INGEST_API_KEYS')
    if ('error' in g) return g.error
    const lim2 = limited(req, 'v1-import-key', 30, 60_000, g.name)
    if (lim2) return lim2

    const declared = Number(req.headers.get('content-length') ?? 0)
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return NextResponse.json({ error: 'Fichier trop volumineux (10 Mo maximum).' }, { status: 413 })

    const sp = new URL(req.url).searchParams
    const type = req.headers.get('content-type') ?? ''
    let buf: Buffer, name: string
    if (type.includes('multipart/form-data')) {
      const file = (await req.formData().catch(() => null))?.get('file')
      if (!(file instanceof File)) return NextResponse.json({ error: 'Champ « file » absent.' }, { status: 400 })
      buf = Buffer.from(await file.arrayBuffer()); name = file.name
    } else {
      buf = Buffer.from(await req.arrayBuffer())
      name = req.headers.get('x-filename') ?? sp.get('filename') ?? (type.includes('spreadsheetml') ? 'export.xlsx' : 'export.csv')
    }
    if (buf.length > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Fichier trop volumineux (10 Mo maximum).' }, { status: 413 })

    const r = await runImport(buf, name, { dryRun: sp.get('dryRun') === '1' })
    if (r.saved || r.status >= 400) {
      // trace (journal d'audit) des envois automatiques : réussis, et refusés (pour comprendre une panne côté expéditeur)
      await prisma.opsAuditLog.create({ data: { actor: `import-auto:${g.name}`, action: r.status < 400 ? 'ops.import_auto' : 'ops.import_auto_refused', entity: 'opsOrder', entityId: null, payload: JSON.stringify({ fileName: name, status: r.status, ...(r.saved ?? {}), error: r.body.error ?? null }), tenantId: null } }).catch(() => {})
    }
    return NextResponse.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const env = envUnavailable(e); if (env) return env
    console.error('[api/v1/import]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
