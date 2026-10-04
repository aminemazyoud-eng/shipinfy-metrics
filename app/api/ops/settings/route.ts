import { NextRequest, NextResponse } from 'next/server'
import { opsAuth, fail, audit } from '@/lib/ops-auth'
import { currentCfg, saveSettings, resetSettings, getStoredSettings } from '@/lib/ops-settings'
import { DEFAULT_CFG, type OpsConfig } from '@/lib/ops-config'

// GET /api/ops/settings — paramètres de calcul en vigueur, défauts, et clés surchargées
export async function GET(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({ config: currentCfg(), defaults: DEFAULT_CFG, overridden: Object.keys(await getStoredSettings()), canEdit: ['ADMIN', 'SUPER_ADMIN'].includes(auth.session.role) })
  } catch (e) { return fail(e) }
}

// PUT /api/ops/settings (ADMIN) { …paramètres } ; { reset: true } remet les valeurs par défaut
export async function PUT(req: NextRequest) {
  const auth = await opsAuth(req, 'ADMIN')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json() as Partial<OpsConfig> & { reset?: boolean }
    const before = currentCfg()
    const config = b.reset ? await resetSettings() : await saveSettings(b)
    await audit(auth.session, b.reset ? 'settings.reset' : 'settings.update', 'config', 'ops', { before, after: config })
    return NextResponse.json({ ok: true, config })
  } catch (e) { return fail(e) }
}
