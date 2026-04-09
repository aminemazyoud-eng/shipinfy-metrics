'use client'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { PieLabelRenderProps } from 'recharts'

interface Props {
  data: Array<{ name: string; value: number; color: string }>
  title: string
}

const RADIAN = Math.PI / 180
const renderLabel = (props: PieLabelRenderProps) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props
  if (!percent || percent < 0.05) return null
  const ir = typeof innerRadius === 'number' ? innerRadius : 0
  const or = typeof outerRadius === 'number' ? outerRadius : 0
  const ma = typeof midAngle === 'number' ? midAngle : 0
  const cxN = typeof cx === 'number' ? cx : 0
  const cyN = typeof cy === 'number' ? cy : 0
  const radius = ir + (or - ir) * 0.5
  const x = cxN + radius * Math.cos(-ma * RADIAN)
  const y = cyN + radius * Math.sin(-ma * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export function ChartStatusPie({ data, title }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <h3 className="mb-1 text-base font-semibold text-gray-900">{title}</h3>
      <p className="mb-3 text-sm text-gray-500">{total.toLocaleString()} commandes au total</p>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" outerRadius={90} dataKey="value" labelLine={false} label={renderLabel}>
            {data.map((entry, index) => <Cell key={index} fill={entry.color} />)}
          </Pie>
          <Tooltip formatter={(v) => {
            const num = typeof v === 'number' ? v : 0
            return [`${num} (${total > 0 ? ((num / total) * 100).toFixed(1) : 0}%)`, '']
          }} />
          <Legend formatter={(value) => <span className="text-xs text-gray-700">{value}</span>} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
