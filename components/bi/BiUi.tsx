'use client'
// Briques d'interface du dashboard « Control Tower » : cartes KPI, tableaux, graphiques en barres, panneaux.
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { n, pct, fix, type Card, type Series, type Tbl } from '@/lib/ops-bi'

export function MetricCards({ cards }: { cards: Card[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map(c => (
        <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{c.label}</span>
          <strong className="mt-1 block text-xl font-bold text-gray-900">{c.value}</strong>
          <small className="mt-0.5 block text-[11px] text-gray-400">{c.note}</small>
        </div>
      ))}
    </div>
  )
}

export function Panel({ title, hint, controls, children, wide }: { title: string; hint?: string; controls?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${wide ? 'col-span-full' : ''}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      </div>
      {children}
      {hint && <p className="mt-2 text-[11px] text-gray-500">{hint}</p>}
    </section>
  )
}

export function DataTable({ t, maxH = 'max-h-[520px]', empty = 'Aucune donnée sur la période.' }: { t: Tbl; maxH?: string; empty?: string }) {
  if (!t.rows.length) return <p className="text-xs text-gray-400">{empty}</p>
  return (
    <div className={`overflow-auto rounded-lg border border-gray-100 ${maxH}`}>
      <table className="w-full min-w-max text-[12px]">
        <thead className="sticky top-0 z-10 bg-gray-50">
          <tr>{t.head.map((h, i) => <th key={i} className={`whitespace-nowrap border-b border-gray-200 px-2.5 py-2 text-[11px] font-semibold text-gray-600 ${i === 0 ? 'sticky left-0 bg-gray-50 text-left' : 'text-right'}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.rows.map((r, ri) => {
            const total = r[0] === 'TOTAL'
            return (
              <tr key={ri} className={total ? 'bg-gray-50 font-bold' : 'hover:bg-blue-50/40'}>
                {r.map((c, ci) => <td key={ci} className={`whitespace-nowrap border-b border-gray-100 px-2.5 py-1.5 text-gray-900 ${ci === 0 ? `sticky left-0 text-left ${total ? 'bg-gray-50' : 'bg-white'}` : 'text-right tabular-nums'}`}>{c}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function HubSelect({ value, onChange, hubs, all = 'Tous les magasins' }: { value: string; onChange: (v: string) => void; hubs: string[]; all?: string }) {
  return (
    <select value={hubs.includes(value) ? value : ''} onChange={e => onChange(e.target.value)} className="max-w-[240px] rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900">
      <option value="">{all}</option>
      {hubs.map(h => <option key={h} value={h}>{h}</option>)}
    </select>
  )
}

export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as T)} className="max-w-[240px] rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

interface BarsProps {
  data: Series; color?: string; horizontal?: boolean; denom?: number | null; share?: boolean; height?: number; rotate?: boolean; compactLabels?: boolean
  /** format de la valeur affichée (défaut : nombre fr-FR) */
  format?: (v: number) => string
}

/** Équivalent du `bars()` canvas du HTML : barres verticales ou horizontales, valeur + part du total. */
export function BarsChart({ data, color = '#1571cb', horizontal = false, denom = null, share = false, height, rotate = false, compactLabels = false, format }: BarsProps) {
  if (!data.length || data.every(d => !d[1])) return <p className="py-6 text-center text-xs text-gray-400">Aucune donnée</p>
  const rows = data.map(([name, value]) => ({ name, value }))
  const showValues = horizontal || rows.length <= 14
  const fmt = (v: number) => (format ? format(v) : share ? fix(v) + ' %' : n(v) + (denom ? ' · ' + pct(v, denom) : ''))
  const h = height ?? (horizontal ? Math.max(180, rows.length * 34 + 30) : 300)
  return (
    <div style={{ width: '100%', height: h }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 22, right: horizontal ? 110 : 12, left: horizontal ? 0 : 4, bottom: rotate ? 54 : 4 }}>
          <CartesianGrid stroke="#e5ebf4" vertical={false} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#526178' }} tickLine={false} axisLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: compactLabels || rows.length > 14 ? 10 : 11, fill: '#59677b' }} interval={rows.length > 16 ? Math.ceil(rows.length / 16) - 1 : 0} angle={rotate ? -90 : 0} textAnchor={rotate ? 'end' : 'middle'} height={rotate ? 60 : 30} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#718198' }} tickFormatter={(v: number) => (share ? v.toFixed(1) + '%' : n(Math.round(v)))} width={52} axisLine={false} tickLine={false} />
            </>
          )}
          <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={80}>
            {showValues && <LabelList dataKey="value" position={horizontal ? 'right' : 'top'} formatter={(v: unknown) => fmt(Number(v))} style={{ fontSize: 10, fill: '#111827' }} />}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
