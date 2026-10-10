import { NextRequest, NextResponse } from 'next/server'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { loadOverview, driverAppConfig } from '@/lib/ops-driver-actions'

export const dynamic = 'force-dynamic'

// GET /api/driver/load — bacs / articles à charger (commandes ouvertes du livreur + stops de sa tournée du jour) et progression du scan.
export async function GET(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const { applyOpsSettings } = await import('@/lib/ops-settings')
    await applyOpsSettings()
    return driverJson({ ...(await loadOverview(d)), required: driverAppConfig().loadScanRequired, serverTime: new Date().toISOString() })
  } catch (e) { console.error('[api/driver/load]', e); return driverJson({ error: 'Erreur serveur' }, 500) }
}
