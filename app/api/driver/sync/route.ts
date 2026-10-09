import { NextRequest, NextResponse } from 'next/server'
import { driverFromRequest, driverJson } from '@/lib/ops-driver-token'
import { envUnavailable } from '@/lib/env'
import { parseAction, processDriverAction, MAX_ACTIONS_PER_SYNC, type ActionResult } from '@/lib/ops-driver-actions'

export const dynamic = 'force-dynamic'

// POST /api/driver/sync { actions: [...] } — actions traitées dans l'ordre reçu, chacune indépendante et idempotente (id généré par le téléphone).
export async function POST(req: NextRequest) {
  const d = await driverFromRequest(req)
  if (d instanceof NextResponse) return d
  try {
    const body = await req.json().catch(() => null) as { actions?: unknown } | null
    if (!body || !Array.isArray(body.actions)) return driverJson({ error: 'actions requises' }, 400)
    if (body.actions.length > MAX_ACTIONS_PER_SYNC) return driverJson({ error: `${MAX_ACTIONS_PER_SYNC} actions maximum par envoi` }, 413)
    const results: ActionResult[] = []
    for (const raw of body.actions) {
      const p = parseAction(raw)
      if ('error' in p) {
        const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : ''
        results.push({ id, ok: false, code: 'BAD_REQUEST', error: 'BAD_REQUEST', message: p.error })
        continue
      }
      results.push(await processDriverAction(d, p.action))
    }
    // poussée best effort vers le back-office sans faire attendre le téléphone (sinon rejouée à la prochaine synchro)
    if (results.some(r => r.ok && r.order && !r.replayed)) void import('@/lib/ops-sync').then(m => m.flushOutbox()).catch(() => {})
    return driverJson({ results, serverTime: new Date().toISOString() })
  } catch (e) {
    const env = envUnavailable(e)
    if (env) { env.headers.set('Cache-Control', 'no-store'); return env }
    console.error('[api/driver/sync]', e)
    return driverJson({ error: 'Erreur serveur' }, 500)
  }
}
