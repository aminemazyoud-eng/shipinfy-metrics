'use client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts'

interface CreneauData {
  creneau: string
  total: number
  delivered: number
  noShow: number
  deliveryRate: number
  onTimeRate: number
  avgDuration: number
}

export function ChartByCreneau({ data }: { data: CreneauData[] }) {
  const filtered = data.filter(d => d.total > 0)
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <h3 className="mb-1 text-base font-semibold text-gray-900">Performance par créneau horaire</h3>
      <p className="mb-4 text-sm text-gray-500">Distribution et taux de livraison par tranche horaire</p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={filtered} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="creneau" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v, n) => {
            const num = typeof v === 'number' ? v : 0
            return n === 'Taux livraison %' ? [`${num}%`, n] : [num, n]
          }} />
          <Legend />
          <Bar dataKey="total" name="Total" fill="#93c5fd" radius={[4, 4, 0, 0]} />
          <Bar dataKey="delivered" name="Livrées" fill="#4ade80" radius={[4, 4, 0, 0]}>
            <LabelList dataKey="deliveryRate" position="top" formatter={(v: unknown) => `${typeof v === 'number' ? v : 0}%`} style={{ fontSize: 10, fill: '#374151', fontWeight: 600 }} />
          </Bar>
          <Bar dataKey="noShow" name="NO_SHOW" fill="#f87171" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
