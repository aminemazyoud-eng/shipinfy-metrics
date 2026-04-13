'use client'
import { Package, CheckCircle, XCircle, TrendingUp, Clock, DollarSign, Calendar, BarChart2 } from 'lucide-react'

interface KPIs {
  totalOrders: number
  delivered: number
  noShow: number
  deliveryRate: number
  onTimeRate: number
  totalCOD: number
  avgOrdersPerDay: number
  avgCODPerOrder: number
}

function calcDiff(current: number, previous: number): { pct: number; up: boolean } | null {
  if (previous === 0) return null
  const pct = Math.round(((current - previous) / previous) * 100 * 10) / 10
  return { pct, up: pct >= 0 }
}

function DiffBadge({ current, previous, invert }: { current: number; previous?: number; invert?: boolean }) {
  if (previous === undefined || previous === null) return null
  const diff = calcDiff(current, previous)
  if (!diff) return null
  // invert=true means higher is worse (e.g. noShow)
  const good = invert ? !diff.up : diff.up
  return (
    <span className={`text-[11px] font-semibold mt-1 flex items-center gap-0.5 ${good ? 'text-green-600' : 'text-red-500'}`}>
      {diff.up ? '▲' : '▼'} {Math.abs(diff.pct)}%
    </span>
  )
}

function Card({ icon, label, value, color, diffEl }: {
  icon: React.ReactNode; label: string; value: string; color: string; diffEl?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
      {diffEl}
    </div>
  )
}

export function KpiCards({ kpis, previousData }: { kpis: KPIs; previousData?: KPIs }) {
  const rateColor = (r: number) => r >= 95 ? 'text-green-600' : r >= 85 ? 'text-orange-500' : 'text-red-600'

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card icon={<Package className="h-5 w-5 text-blue-600" />} label="Commandes total" value={kpis.totalOrders.toLocaleString()} color="bg-blue-50"
        diffEl={<DiffBadge current={kpis.totalOrders} previous={previousData?.totalOrders} />} />
      <Card icon={<CheckCircle className="h-5 w-5 text-green-600" />} label="Livrées" value={kpis.delivered.toLocaleString()} color="bg-green-50"
        diffEl={<DiffBadge current={kpis.delivered} previous={previousData?.delivered} />} />
      <Card icon={<XCircle className="h-5 w-5 text-red-600" />} label="Non livrées (NO_SHOW)" value={kpis.noShow.toLocaleString()} color="bg-red-50"
        diffEl={<DiffBadge current={kpis.noShow} previous={previousData?.noShow} invert />} />
      <Card icon={<TrendingUp className={`h-5 w-5 ${rateColor(kpis.deliveryRate)}`} />} label="Taux de livraison" value={`${kpis.deliveryRate}%`} color={kpis.deliveryRate >= 95 ? 'bg-green-50' : kpis.deliveryRate >= 85 ? 'bg-orange-50' : 'bg-red-50'}
        diffEl={<DiffBadge current={kpis.deliveryRate} previous={previousData?.deliveryRate} />} />
      <Card icon={<Clock className="h-5 w-5 text-orange-500" />} label="Taux on-time (promesse)" value={`${kpis.onTimeRate}%`} color="bg-orange-50"
        diffEl={<DiffBadge current={kpis.onTimeRate} previous={previousData?.onTimeRate} />} />
      <Card icon={<DollarSign className="h-5 w-5 text-violet-600" />} label="Total COD" value={`${kpis.totalCOD.toLocaleString('fr-MA', { minimumFractionDigits: 0 })} MAD`} color="bg-violet-50"
        diffEl={<DiffBadge current={kpis.totalCOD} previous={previousData?.totalCOD} />} />
      <Card icon={<Calendar className="h-5 w-5 text-blue-600" />} label="Moy. commandes/jour" value={kpis.avgOrdersPerDay.toLocaleString()} color="bg-blue-50"
        diffEl={<DiffBadge current={kpis.avgOrdersPerDay} previous={previousData?.avgOrdersPerDay} />} />
      <Card icon={<BarChart2 className="h-5 w-5 text-indigo-600" />} label="Moy. COD/commande" value={`${kpis.avgCODPerOrder.toLocaleString('fr-MA')} MAD`} color="bg-indigo-50"
        diffEl={<DiffBadge current={kpis.avgCODPerOrder} previous={previousData?.avgCODPerOrder} />} />
    </div>
  )
}
