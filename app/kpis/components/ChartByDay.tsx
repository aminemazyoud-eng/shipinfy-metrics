'use client'
import { ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface DayData {
  date: string
  total: number
  delivered: number
  noShow: number
  totalCOD: number
  avgDuration: number
  deliveryRate: number
}

export function ChartByDay({ data }: { data: DayData[] }) {
  const fmt = (d: string) => {
    const parts = d.split('-')
    return `${parts[2]}/${parts[1]}`
  }

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <h3 className="mb-1 text-base font-semibold text-gray-900">Tendance journalière</h3>
      <p className="mb-4 text-sm text-gray-500">Volume et taux de livraison par jour</p>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="colorDelivered" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tickFormatter={fmt} tick={{ fontSize: 11 }} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
          <Tooltip
            labelFormatter={l => String(l)}
            formatter={(value, name) => {
              const num = typeof value === 'number' ? value : 0
              return name === 'Taux %' ? [`${num}%`, name] : [num, name]
            }}
          />
          <Legend />
          <Bar yAxisId="left" dataKey="total" name="Total" fill="#bfdbfe" radius={[3, 3, 0, 0]} />
          <Area yAxisId="left" type="monotone" dataKey="delivered" name="Livrées" fill="url(#colorDelivered)" stroke="#22c55e" strokeWidth={2} />
          <Bar yAxisId="left" dataKey="noShow" name="NO_SHOW" fill="#fca5a5" radius={[3, 3, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="deliveryRate" name="Taux %" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
