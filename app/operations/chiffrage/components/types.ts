export interface Breakdown { driver: number; helper: number; charges: number; fuel: number; maintenance: number; vehicle: number; equipment: number; total: number }
export type Status = 'ok' | 'warn' | 'bad' | 'nd'
export interface Row {
  key: string; label: string; orders: number; teamDays: number; km: number; cost: number; costPerOrder: number | null
  revenue: number; margin: number | null; marginPerOrder: number | null; breakdown: Breakdown
  gapVsMax: number | null; gapPct: number | null; status: Status; estimated: boolean; estimatedCostPct: number
}
export interface Summary {
  orders: number; teamDays: number; km: number; cost: number; costPerOrder: number | null; revenue: number; margin: number | null; marginPerOrder: number | null
  avgDayCost: number | null; avgRotations: number | null; avgOrdersPerRotation: number | null; avgKmPerOrder: number | null
  breakdown: Breakdown; gapVsMax: number | null; gapPct: number | null; status: Status; dayCostGap: number | null
  estimated: boolean; estimatedCostPct: number; estimatedParts: string[]
}
export interface Targets { costMin: number; costMax: number; vehicleDayCost: number; rotationsPerDay: number; ordersPerRotationMin: number; ordersPerRotationMax: number; pricePerOrder: number }
export interface CostingRes { from: string; to: string; groupBy: string; summary: Summary; rows: Row[]; targets: Targets; meta: { deliveredTotal: number; deliveredWithoutTeam: number; frozenMonths: string[]; tours: number; paySource: string } }
export interface Anomaly { kind: string; severity: 'info' | 'warn' | 'critical'; title: string; detail: string; recommendation: string; value: number | null; threshold: number | null; estimated: boolean }

export const mad = (n: number | null | undefined, d = 2) => (n == null ? 'n/d' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} MAD`)
export const STATUS_CLS: Record<Status, string> = { ok: 'text-green-700 bg-green-50', warn: 'text-amber-700 bg-amber-50', bad: 'text-red-700 bg-red-50', nd: 'text-gray-400 bg-gray-50' }
export const EST_BADGE = 'ml-1 text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 font-medium align-middle'
