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

function Card({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  )
}

export function KpiCards({ kpis }: { kpis: KPIs }) {
  const rateColor = (r: number) => r >= 95 ? 'text-green-600' : r >= 85 ? 'text-orange-500' : 'text-red-600'

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card icon={<Package className="h-5 w-5 text-blue-600" />} label="Commandes total" value={kpis.totalOrders.toLocaleString()} color="bg-blue-50" />
      <Card icon={<CheckCircle className="h-5 w-5 text-green-600" />} label="Livrées" value={kpis.delivered.toLocaleString()} color="bg-green-50" />
      <Card icon={<XCircle className="h-5 w-5 text-red-600" />} label="Non livrées (NO_SHOW)" value={kpis.noShow.toLocaleString()} color="bg-red-50" />
      <Card icon={<TrendingUp className={`h-5 w-5 ${rateColor(kpis.deliveryRate)}`} />} label="Taux de livraison" value={`${kpis.deliveryRate}%`} color={kpis.deliveryRate >= 95 ? 'bg-green-50' : kpis.deliveryRate >= 85 ? 'bg-orange-50' : 'bg-red-50'} />
      <Card icon={<Clock className="h-5 w-5 text-orange-500" />} label="Taux on-time (promesse)" value={`${kpis.onTimeRate}%`} color="bg-orange-50" />
      <Card icon={<DollarSign className="h-5 w-5 text-violet-600" />} label="Total COD" value={`${kpis.totalCOD.toLocaleString('fr-MA', { minimumFractionDigits: 0 })} MAD`} color="bg-violet-50" />
      <Card icon={<Calendar className="h-5 w-5 text-blue-600" />} label="Moy. commandes/jour" value={kpis.avgOrdersPerDay.toLocaleString()} color="bg-blue-50" />
      <Card icon={<BarChart2 className="h-5 w-5 text-indigo-600" />} label="Moy. COD/commande" value={`${kpis.avgCODPerOrder.toLocaleString('fr-MA')} MAD`} color="bg-indigo-50" />
    </div>
  )
}
