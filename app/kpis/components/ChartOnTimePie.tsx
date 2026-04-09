'use client'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Props {
  data: Array<{ name: string; value: number; color: string }>
  onTimeRate: number
}

export function ChartOnTimePie({ data, onTimeRate }: Props) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <h3 className="mb-1 text-base font-semibold text-gray-900">Respect des créneaux</h3>
      <p className="mb-3 text-sm text-gray-500">Livraisons dans les délais promis</p>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" strokeWidth={2}>
            {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
          </Pie>
          <Tooltip formatter={(v) => {
            const num = typeof v === 'number' ? v : 0
            return [`${num} commandes`, '']
          }} />
          <Legend formatter={(value) => <span className="text-xs text-gray-700">{value}</span>} />
          <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fill="#111827" fontSize={20} fontWeight="bold">{onTimeRate}%</text>
          <text x="50%" y="56%" textAnchor="middle" dominantBaseline="middle" fill="#6b7280" fontSize={11}>on-time</text>
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
