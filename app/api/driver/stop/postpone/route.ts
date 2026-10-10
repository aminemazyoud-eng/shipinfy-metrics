import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { envUnavailable } from '@/lib/env'
import { getTourForDriver, postponeStop } from '@/lib/ops-tours'
import { localToday } from '@/lib/tz'
import { limited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// POST /api/driver/stop/postpone { id, orderId } — reporte le stop en fin de tournée. `id` = identifiant d'action généré par le téléphone (idempotent :
// un rejeu renvoie le résultat d'origine sans reporter une 2e fois ; réutilise OpsDriverAction comme lib/ops-driver-actions.ts).
// → même forme que GET /api/driver/tour + result:{ ok, code?, message?, replayed? }. HTTP 200 même pour un refus métier (result.ok=false :
// BAD_STATE, MAX_POSTPONES, ALREADY_LAST, NOT_FOUND, CONFLICT) afin que la file hors-ligne ne rejoue pas en boucle ; 400 = requête mal formée.
export async function POST(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const l = limited(req, 'driver-postpone', 30, 60_000, d.code)
    if (l) { l.headers.set('Cache-Control', 'no-store'); return l }
    const b = await req.json().catch(() => null) as { id?: unknown; orderId?: unknown } | null
    if (!b || typeof b.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(b.id) || typeof b.orderId !== 'string' || !b.orderId || b.orderId.length > 64) return driverJson({ error: 'id et orderId requis' }, 400)
    const id = b.id, orderId = b.orderId
    const day = localToday()
    const respond = async (result: Record<string, unknown>) => driverJson({ ...(await getTourForDriver(d.code, day)), result, serverTime: new Date().toISOString() })

    // réservation de l'identifiant AVANT d'agir : deux envois simultanés du même id ne reportent qu'une fois
    try {
      await prisma.opsDriverAction.create({ data: { id, driverCode: d.code, orderId, type: 'postpone', ok: false, result: null, payload: null } })
    } catch {
      const prev = await prisma.opsDriverAction.findUnique({ where: { id } })
      if (!prev || prev.driverCode !== d.code || prev.type !== 'postpone') return driverJson({ error: 'Identifiant d\'action déjà utilisé', code: 'ID_CONFLICT' }, 409)
      let r: Record<string, unknown> = { ok: prev.ok }
      try { if (prev.result) r = JSON.parse(prev.result) } catch { /* garde ok */ }
      if (prev.result == null) r = { ok: false, code: 'IN_PROGRESS', message: 'Action en cours de traitement, réessayez' }
      return respond({ ...r, replayed: true })
    }
    let result: Record<string, unknown>
    try {
      const r = await postponeStop(d.code, orderId)
      result = { ok: r.ok, ...(r.code ? { code: r.code } : {}), ...(r.message ? { message: r.message } : {}), ...(r.postponedCount != null ? { postponedCount: r.postponedCount } : {}) }
    } catch (e) {
      await prisma.opsDriverAction.delete({ where: { id } }).catch(() => {}) // échec technique : l'identifiant reste rejouable
      throw e
    }
    await prisma.opsDriverAction.update({ where: { id }, data: { ok: result.ok === true, result: JSON.stringify(result) } }).catch(() => {})
    if (result.ok) {
      const { audit } = await import('@/lib/ops-auth')
      await audit({ userId: `driver:${d.code}`, tenantId: d.tenantId, role: 'VIEWER', name: `Livreur ${d.code}`, email: '' }, 'driver.postpone', 'order', orderId, { postponedCount: result.postponedCount }, d.hub?.code)
    }
    return respond(result)
  } catch (e) {
    const env = envUnavailable(e)
    if (env) { env.headers.set('Cache-Control', 'no-store'); return env }
    console.error('[api/driver/stop/postpone]', e)
    return driverJson({ error: 'Erreur serveur' }, 500)
  }
}
