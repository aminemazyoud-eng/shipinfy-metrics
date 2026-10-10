import { NextRequest, NextResponse } from 'next/server'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { setOdometer } from '@/lib/ops-driver-actions'

export const dynamic = 'force-dynamic'

// POST /api/driver/odometer { id, kind: 'start' | 'end', km } — relevé du compteur sur l'OpsTour du jour (créée en rotation 1 si absente). Idempotent par id.
export async function POST(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const b = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!b || typeof b.id !== 'string') return driverJson({ error: 'id, kind et km requis', code: 'BAD_REQUEST' }, 400)
    const r = await setOdometer(d, { id: b.id, kind: b.kind, km: b.km })
    return driverJson(r, r.ok ? 200 : r.code === 'ID_CONFLICT' ? 409 : 422)
  } catch (e) { console.error('[api/driver/odometer]', e); return driverJson({ error: 'Erreur serveur' }, 500) }
}
