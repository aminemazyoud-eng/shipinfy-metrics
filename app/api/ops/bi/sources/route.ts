import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail } from '@/lib/ops-auth'
import { biSources, biDefaultSource } from '@/lib/ops-bi-data'

// GET /api/ops/bi/sources — sources de données disponibles pour le Dashboard : « active » (API du back-office) et « import » (fichier d'export),
// avec le nombre de commandes, la période couverte et la dernière mise à jour de chacune.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({ sources: await biSources(), defaultKey: biDefaultSource() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return fail(e)
  }
}
