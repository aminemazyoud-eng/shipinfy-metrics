import { NextRequest, NextResponse } from 'next/server'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { driverAppConfig } from '@/lib/ops-driver-actions'

export const dynamic = 'force-dynamic'

// GET /api/driver/me — profil du livreur authentifié (jeton x-driver-token) + seuils de l'application.
export async function GET(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  const { applyOpsSettings } = await import('@/lib/ops-settings')
  await applyOpsSettings()
  const v = d.vehicle
  return driverJson({
    driver: {
      code: d.code, name: `${d.firstName} ${d.lastName}`.trim(), firstName: d.firstName, lang: d.lang,
      hubCode: d.hub?.code ?? null, hubName: d.hub?.name ?? null, hubLat: d.hub?.lat ?? null, hubLng: d.hub?.lng ?? null,
      vehicle: v ? ([v.brand, v.model].filter(Boolean).join(' ') || v.type) : null, plate: v?.plate ?? null,
    },
    serverTime: new Date().toISOString(),
    config: driverAppConfig(),
  })
}
