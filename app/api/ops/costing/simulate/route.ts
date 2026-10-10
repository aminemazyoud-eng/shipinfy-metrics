import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { opsAuth, fail } from '@/lib/ops-auth'
import { loadParams, runSimulation, DEFAULT_SIM_BASE } from '@/lib/ops-costing'

const num = (v: unknown, def: number, min: number, max: number): number => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def }

// POST /api/ops/costing/simulate { ordersPerRotation, rotationsPerDay, helper, fuelPrice, kmPerOrder, price? }
// Simulateur pur (aucune écriture) : coût/commande, marge, seuil de rentabilité, comparaison avec/sans helper, balayage 1→8 cmd/rotation, recommandations. Résultat toujours `estimated: true`.
export async function POST(req: NextRequest) {
  const auth = await opsAuth(req, 'MANAGER')
  if ('error' in auth) return auth.error
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const { params } = await loadParams()
    const cfg = await prisma.opsPayConfig.findUnique({ where: { id: 'default' } })
    const base = { ...DEFAULT_SIM_BASE, driverDailyRate: cfg?.dailyRate ?? DEFAULT_SIM_BASE.driverDailyRate, helperDailyRate: cfg?.helperDailyRate ?? params['helper.dailyRateFallback'], bonusThreshold: cfg?.bonusThreshold ?? DEFAULT_SIM_BASE.bonusThreshold, bonusPerOrder: cfg?.bonusPerOrder ?? DEFAULT_SIM_BASE.bonusPerOrder, consumptionL100: params['fuel.defaultL100'] }
    const mid = (params['target.ordersPerRotationMin'] + params['target.ordersPerRotationMax']) / 2
    const out = runSimulation({
      ordersPerRotation: num(b.ordersPerRotation, mid, 0, 30), rotationsPerDay: num(b.rotationsPerDay, params['target.rotationsPerDay'], 0, 30),
      helper: typeof b.helper === 'boolean' ? b.helper : params['helper.enabled'] !== 0,
      fuelPrice: num(b.fuelPrice, params['fuel.priceMad'], 0, 50), kmPerOrder: num(b.kmPerOrder, params['km.perOrderFallback'], 0, 200),
      priceOverride: b.price == null ? undefined : num(b.price, params['price.perOrder'], 0, 1000), base,
    }, params)
    return NextResponse.json({ ...out, targets: { costMin: params['target.costMin'], costMax: params['target.costMax'], vehicleDayCost: params['target.vehicleDayCost'] }, base })
  } catch (e) { return fail(e) }
}
