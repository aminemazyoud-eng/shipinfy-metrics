import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, audit, fail } from '@/lib/ops-auth'
import { runImport } from '@/lib/ops-import-run'
import { purgeImport } from '@/lib/ops-import-db'

export const runtime = 'nodejs'

// POST /api/ops/import[?dryRun=1] — import MANUEL depuis l'écran du Dashboard (session MANAGER+) : multipart « file » (.csv ou .xlsx, 10 Mo max).
//   dryRun=1 : analyse le fichier et renvoie le résumé SANS rien enregistrer (étape « Vérifier »).
//   L'envoi AUTOMATIQUE par le système source (toutes les 5 min) passe par POST /api/v1/import (clé d'API).
// DELETE /api/ops/import — supprime toutes les commandes importées (ADMIN+). Les données de l'API ne sont jamais touchées.
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
    const file = (await req.formData().catch(() => null))?.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Aucun fichier reçu (champ « file »).' }, { status: 400 })
    const r = await runImport(Buffer.from(await file.arrayBuffer()), file.name, { dryRun })
    if (r.saved) await audit(auth.session, 'ops.import_file', 'opsOrder', null, { fileName: file.name, ...r.saved, rejected: r.summary?.rejected, period: r.summary?.period })
    return NextResponse.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return fail(e)
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const r = await purgeImport()
    await audit(auth.session, 'ops.import_purge', 'opsOrder', null, r)
    return NextResponse.json({ success: true, ...r })
  } catch (e) {
    return fail(e)
  }
}
