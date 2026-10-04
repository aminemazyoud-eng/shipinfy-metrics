import { NextRequest, NextResponse } from 'next/server'
import { opsAuth } from '@/lib/ops-auth'
import { loadHubs } from '@/lib/ops-data'

// GET /api/ops/hubs — hubs actifs (code, nom, ville, coordonnées)
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req)
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({ hubs: await loadHubs() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 })
  }
}
