import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'

// Import Excel/CSV désactivé : l'application travaille 100 % en temps réel (OpsOrder / rapport LIVE).
// Aucune table ni donnée n'est supprimée ; seule l'entrée d'import est neutralisée.
export async function POST(request: Request) {
  const _guard = await requireSession(request, 'MANAGER'); if ('error' in _guard) return _guard.error
  return NextResponse.json({ error: 'Import désactivé : données en temps réel' }, { status: 410 })
}
