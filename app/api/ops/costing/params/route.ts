import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { loadParams, saveParams, resetParams, validateParamUpdate, COST_PARAM_DEFS, DEFAULT_COST_PARAMS } from '@/lib/ops-costing'

// GET /api/ops/costing/params — paramètres de chiffrage effectifs, défauts, définitions (libellé, unité, bornes). MANAGER+.
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const { params, stored } = await loadParams()
    return NextResponse.json({ params, defaults: DEFAULT_COST_PARAMS, defs: COST_PARAM_DEFS, overridden: Object.keys(stored), canEdit: ['ADMIN', 'SUPER_ADMIN'].includes(auth.session.role) })
  } catch (e) { return fail(e) }
}

// PUT /api/ops/costing/params (ADMIN) { "target.costMax": 27.08, … } ; { "reset": true } supprime toutes les surcharges
export async function PUT(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const before = (await loadParams()).params
    if (body && body.reset === true) {
      await resetParams()
      await audit(auth.session, 'costing.params.reset', 'config', 'costing', { before })
      return NextResponse.json({ ok: true, params: (await loadParams()).params })
    }
    const v = validateParamUpdate(body)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    await saveParams(v.clean)
    const after = (await loadParams()).params
    await audit(auth.session, 'costing.params.update', 'config', 'costing', { changed: v.clean, before, after })
    return NextResponse.json({ ok: true, params: after })
  } catch (e) { return fail(e) }
}
