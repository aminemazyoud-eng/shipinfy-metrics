'use client'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface DayData { date: string; totalCOD: number; delivered: number }

export function ChartCODArea({ data }: { data: DayData[] }) {
  const fmt = (d: string) => { const [, m, day] = d.split('-'); return `${day}/${m}` }
  const fmtMAD = (v: number) => `${Math.round(v).toLocaleString('fr-MA')} MAD`
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <h3 className="mb-1 text-base font-semibold text-gray-900">Évolution COD journalier</h3>
      <p className="mb-4 text-sm text-gray-500">Montant total collecté par jour</p>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="codGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tickFormatter={fmt} tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={v => `${Math.round(v / 1000)}k`} tick={{ fontSize: 10 }} />
          <Tooltip labelFormatter={l => String(l)} formatter={(v) => {
            const num = typeof v === 'number' ? v : 0
            return [fmtMAD(num), 'COD']
          }} />
          <Area type="monotone" dataKey="totalCOD" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#codGrad)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
