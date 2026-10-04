import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { directMode, loadHubs } from '@/lib/ops-data'

// GET /api/ops/hubs — hubs actifs (code, nom, ville, coordonnées)
export async function GET(req: NextRequest) {
  if (!directMode()) {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  try {
    return NextResponse.json({ hubs: await loadHubs() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 })
  }
}
