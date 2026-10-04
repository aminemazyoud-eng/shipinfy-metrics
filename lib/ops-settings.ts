/**
 * lib/ops-settings.ts — lecture / écriture des paramètres de calcul (table OpsSetting) et application à CFG.
 * Les paramètres surchargent lib/ops-config.ts ; ils sont rechargés au plus toutes les 20 s.
 */
import { prisma } from '@/lib/prisma'
import { CFG, DEFAULT_CFG, setCfg, type OpsConfig } from '@/lib/ops-config'

let loadedAt = 0

export async function getStoredSettings(): Promise<Partial<OpsConfig>> {
  const rows = await prisma.opsSetting.findMany()
  const out: Record<string, unknown> = {}
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value) } catch { /* valeur illisible ignorée */ } }
  return out as Partial<OpsConfig>
}

/** Applique les paramètres enregistrés à CFG (cache 20 s). N'échoue jamais : en cas d'erreur, les défauts restent. */
export async function applyOpsSettings(force = false) {
  if (!force && Date.now() - loadedAt < 20_000) return
  try { setCfg({ ...DEFAULT_CFG, ...(await getStoredSettings()) }); loadedAt = Date.now() } catch { /* table absente ou base indisponible */ }
}

export const currentCfg = (): OpsConfig => ({ ...CFG, slots: CFG.slots.map(s => ({ ...s })) })

export async function saveSettings(patch: Partial<OpsConfig>) {
  const clean: Record<string, unknown> = {}
  for (const k of Object.keys(DEFAULT_CFG) as (keyof OpsConfig)[]) {
    const v = patch[k]; if (v === undefined) continue
    if (k === 'slots') { if (Array.isArray(v) && v.length >= 1 && v.length <= 8) clean[k] = (v as OpsConfig['slots']).map(s => ({ label: `${String(s.startHour).padStart(2, '0')}-${String((Number(s.startHour) + 3) % 24).padStart(2, '0')}`, startHour: Number(s.startHour) })); continue }
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[k] = v
  }
  for (const [key, value] of Object.entries(clean)) {
    await prisma.opsSetting.upsert({ where: { key }, update: { value: JSON.stringify(value) }, create: { key, value: JSON.stringify(value) } })
  }
  await applyOpsSettings(true)
  return currentCfg()
}

export async function resetSettings() {
  await prisma.opsSetting.deleteMany()
  setCfg(DEFAULT_CFG); loadedAt = Date.now()
  return currentCfg()
}
