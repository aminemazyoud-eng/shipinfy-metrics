'use client'
import { useState, useEffect, useCallback } from 'react'
import { History, Download } from 'lucide-react'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'

interface Row { key: string; total: number; delivered: number; noShow: number; onTimeRate: number | null; noShowRate: number | null; deliveryRate: number | null; amount: number }
interface Res { from: string; to: string; totals: Row & { days: number; avgPerDay: number }; byDay: Row[]; byHub: Row[]; bySlot: Row[]; byDriver: Row[]
  weekdayMatrix: { weekday: number; days: number; slots: Record<string, number> }[]; arrivalCurve: { hoursBefore: number; knownPct: number | null }[] }

interface KpiV { value: number | null; unit: '%' | 'MAD' | 'liv/h'; formula: string; num?: number; den?: number; note?: string }
interface Kpis { otif: KpiV; cancelRate: KpiV; firstAttemptSuccess: KpiV; deliveriesPerHour: KpiV; fleetUtilization: KpiV; costPerDelivery: KpiV; cancelReasons: { reason: string; count: number }[]
  csat?: { average: number | null; count: number; responseRate: number | null; nps: number | null; formula: string; npsFormula: string } | null
  etaAccuracy?: { mae: number | null; withinTolerancePct: number | null; samples: number; insufficient: boolean; formula: string } | null
  otpCoverage?: { value: number | null; num: number; den: number; formula: string } | null }
const KPI_CARDS: [Exclude<keyof Kpis, 'cancelReasons' | 'csat' | 'etaAccuracy' | 'otpCoverage'>, string][] = [['otif', 'OTIF (à l’heure et complète)'], ['firstAttemptSuccess', 'Réussite au 1er passage'], ['cancelRate', 'Taux d’annulation'], ['deliveriesPerHour', 'Livraisons / heure'], ['fleetUtilization', 'Utilisation flotte'], ['costPerDelivery', 'Coût / livraison']]
const kfmt = (k: KpiV) => (k.value == null ? 'n/d' : k.unit === '%' ? `${String(k.value).replace('.', ',')} %` : k.unit === 'MAD' ? `${String(k.value).replace('.', ',')} MAD` : `${String(k.value).replace('.', ',')} /h`)

const WD = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
const iso = (d: Date) => d.toISOString().slice(0, 10)
const pc = (v: number | null) => (v == null ? '—' : `${v}%`)

function Table({ title, rows, label }: { title: string; rows: Row[]; label: (k: string) => string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
      <div className="p-3 text-sm font-medium text-gray-700 border-b border-gray-100">{title}</div>
      <table className="w-full text-sm"><thead><tr className="text-xs text-gray-500 text-left"><th className="p-2 pl-3 font-medium"> </th><th className="p-2 font-medium">Cmd</th><th className="p-2 font-medium">Livrées</th><th className="p-2 font-medium">À l&apos;heure</th><th className="p-2 font-medium">NO_SHOW</th></tr></thead>
        <tbody>{rows.slice(0, 12).map(r => <tr key={r.key} className="border-t border-gray-100"><td className="p-2 pl-3">{label(r.key)}</td><td className="p-2">{r.total}</td><td className="p-2">{r.delivered}</td><td className={`p-2 ${r.onTimeRate != null && r.onTimeRate < 85 ? 'text-red-600' : ''}`}>{pc(r.onTimeRate)}</td><td className="p-2 text-gray-500">{pc(r.noShowRate)}</td></tr>)}</tbody></table>
    </div>
  )
}

export default function MetricsPage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000))); const [to, setTo] = useState(iso(new Date()))
  const [res, setRes] = useState<Res | null>(null)
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const load = useCallback(async () => { const r = await fetch(`/api/ops/history?from=${from}&to=${to}`); if (r.ok) setRes(await r.json()) }, [from, to])
  useEffect(() => { load() }, [load])
  useEffect(() => { setKpis(null); fetch(`/api/ops/kpis?from=${from}&to=${to}`).then(r => r.ok ? r.json() : null).then(j => j && setKpis(j)).catch(() => {}) }, [from, to])
  const max = Math.max(1, ...(res?.weekdayMatrix.flatMap(w => Object.values(w.slots)) ?? [1]))
  const slots = res ? Object.keys(res.weekdayMatrix[0]?.slots ?? {}) : []

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><History className="w-5 h-5 text-blue-600" />Metrics</h1>
      <p className="text-sm text-gray-500 -mt-2">Volumes, ponctualité, NO_SHOW par jour, hub, créneau et livreur ; courbe d&apos;arrivée des commandes. Données du back-office (même source que le Cockpit). La liste des commandes terminées est dans Opérations → Historique.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500">Au<input type="date" value={to} onChange={e => setTo(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <a href={`/api/ops/history?from=${from}&to=${to}&format=xlsx`} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-purple-600 text-white"><Download className="w-4 h-4" />Export Excel</a>
      </div>

      {res && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[['Commandes', res.totals.total], ['Moy. / jour', res.totals.avgPerDay], ['Livrées', pc(res.totals.deliveryRate)], ['À l\'heure', pc(res.totals.onTimeRate)], ['NO_SHOW', pc(res.totals.noShowRate)]].map(([l, v]) => <div key={l as string} className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">{l}</div><div className="text-xl font-bold text-gray-900">{v}</div></div>)}
          </div>

          {kpis && (
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">KPIs de référence <span className="text-xs font-normal text-gray-400">· survolez une carte pour voir la formule</span></div>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {KPI_CARDS.map(([key, label]) => { const k = kpis[key]; return (
                  <div key={key} title={`${k.formula}${k.num != null && k.den != null ? `
= ${k.num} / ${k.den}` : ''}${k.note ? `
${k.note}` : ''}`} className="bg-white border border-gray-200 rounded-xl p-3 cursor-help">
                    <div className="text-xs text-gray-500">{label}</div>
                    <div className={`text-xl font-bold ${k.value == null ? 'text-gray-300' : 'text-gray-900'}`}>{kfmt(k)}</div>
                    {k.note && <div className="text-[10px] text-amber-600 mt-0.5 line-clamp-2">{k.note}</div>}
                  </div>
                ) })}
              </div>
              {(() => {
                const fr = (v: number | null | undefined, suffix = '') => (v == null ? 'n/d' : `${String(v).replace('.', ',')}${suffix}`)
                const c = kpis.csat, e = kpis.etaAccuracy, o = kpis.otpCoverage
                const cards: { label: string; value: string; sub?: string; tip: string }[] = [
                  { label: 'Satisfaction client (CSAT)', value: fr(c?.average, ' / 5'), sub: c ? `${c.count} note(s) · réponse ${fr(c.responseRate, ' %')}` : undefined, tip: c ? `${c.formula}${c.count ? `\n= ${c.count} notes` : ''}` : 'CSAT = moyenne des notes (1 à 5) des clients sur la période' },
                  { label: 'NPS-like', value: fr(c?.nps, ' pts'), sub: 'notes 4-5 moins notes 1-2', tip: c?.npsFormula ?? 'NPS-like = % de notes 4-5 − % de notes 1-2' },
                  { label: 'Précision ETA (MAE)', value: e && !e.insufficient ? fr(e.mae, ' min') : 'n/d', sub: e ? (e.insufficient ? `${e.samples} échantillon(s), minimum 20` : `${fr(e.withinTolerancePct, ' %')} à ±15 min · ${e.samples} liv.`) : undefined, tip: e?.formula ?? 'MAE = erreur absolue moyenne entre ETA prédite et heure réelle' },
                  { label: 'Couverture code de remise', value: fr(o?.value, ' %'), sub: o ? `${o.num} / ${o.den} livrées` : undefined, tip: o ? `${o.formula}\n= ${o.num} / ${o.den}` : 'Couverture = livraisons avec code vérifié ÷ livrées × 100' },
                ]
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    {cards.map(k => (
                      <div key={k.label} title={k.tip} className="bg-white border border-gray-200 rounded-xl p-3 cursor-help">
                        <div className="text-xs text-gray-500">{k.label}</div>
                        <div className={`text-xl font-bold ${k.value === 'n/d' ? 'text-gray-300' : 'text-gray-900'}`}>{k.value}</div>
                        {k.sub && <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{k.sub}</div>}
                      </div>
                    ))}
                  </div>
                )
              })()}
              {kpis.cancelReasons.length > 0 && <div className="mt-2 text-xs text-gray-500">Motifs d&apos;annulation : {kpis.cancelReasons.map(c => `${c.reason} (${c.count})`).join(' · ')}</div>}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="text-sm font-medium text-gray-700 mb-2">Volume et ponctualité par jour</div>
            <div className="h-64"><ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={res.byDay}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="key" tickFormatter={(d: string) => d.slice(5)} fontSize={11} /><YAxis yAxisId="l" fontSize={11} /><YAxis yAxisId="r" orientation="right" domain={[0, 100]} fontSize={11} unit="%" /><Tooltip /><Legend />
                <Bar yAxisId="l" dataKey="total" name="Commandes" fill="#a78bfa" radius={[3, 3, 0, 0]} /><Line yAxisId="r" dataKey="onTimeRate" name="% à l'heure" stroke="#16a34a" dot={false} strokeWidth={2} /></ComposedChart>
            </ResponsiveContainer></div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <div className="text-sm font-medium text-gray-700 mb-2">Volume moyen par jour de semaine × créneau</div>
              <table className="w-full text-sm text-center"><thead><tr className="text-xs text-gray-500"><th className="text-left">Jour</th>{slots.map(s => <th key={s} className="font-medium">{s.replace('-', 'h–')}h</th>)}</tr></thead>
                <tbody>{res.weekdayMatrix.map(w => <tr key={w.weekday}><td className="text-left py-1 text-gray-600">{WD[w.weekday]} <span className="text-[10px] text-gray-400">({w.days}j)</span></td>{slots.map(s => <td key={s} className="p-0.5"><div className="rounded py-1" style={{ background: `rgba(124,58,237,${0.08 + (w.slots[s] / max) * 0.7})`, color: w.slots[s] / max > 0.5 ? '#fff' : '#333' }}>{w.slots[s]}</div></td>)}</tr>)}</tbody></table>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <div className="text-sm font-medium text-gray-700">Courbe d&apos;arrivée des commandes</div>
              <p className="text-xs text-gray-400 mb-3">Part du volume final déjà connue avant le début du créneau — base de l&apos;anticipation.</p>
              <div className="space-y-2">{res.arrivalCurve.map(a => <div key={a.hoursBefore} className="flex items-center gap-2 text-sm"><span className="w-20 text-gray-500">{a.hoursBefore === 0 ? 'Au début' : `H−${a.hoursBefore}`}</span><div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-purple-500" style={{ width: `${a.knownPct ?? 0}%` }} /></div><span className="w-12 text-right font-medium">{pc(a.knownPct)}</span></div>)}</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <Table title="Par hub" rows={res.byHub} label={k => k} />
            <Table title="Par créneau" rows={res.bySlot} label={k => `${k.replace('-', 'h–')}h`} />
            <Table title="Par livreur (top 12)" rows={res.byDriver} label={k => k} />
          </div>

        </>
      )}
    </div>
  )
}
