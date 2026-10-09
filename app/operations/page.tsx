'use client'
import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Activity, RefreshCw, AlertTriangle, Clock, Users, TrendingUp, Layers } from 'lucide-react'
import OpsNav from './components/OpsNav'
import ForecastBoard from './components/ForecastBoard'
import HubDrawer from './components/HubDrawer'
import type { LiveResult } from '@/lib/ops-analytics'
import type { ForecastWithSpecial } from '@/lib/ops-special-days'
import { usePolling } from '@/lib/use-polling'

const LiveMap = dynamic(() => import('./components/LiveMap'), { ssr: false, loading: () => <div className="h-[520px] rounded-xl bg-gray-100 animate-pulse" /> })

type Tab = 'previsions' | 'live' | 'carte'
const CITIES = [{ v: '', l: 'Toutes les villes' }, { v: 'CASABLANCA', l: 'Casablanca' }, { v: 'MARRAKECH', l: 'Marrakech' }, { v: 'AGADIR', l: 'Agadir' }]
const DAYS = [{ v: 'today', l: "Aujourd'hui" }, { v: 'tomorrow', l: 'Demain' }, { v: '2', l: 'J+2' }]

const STATUS_META: { key: string; label: string; color: string }[] = [
  { key: 'READY_PICKUP', label: 'À dispatcher', color: '#3b82f6' }, { key: 'ASSIGNED', label: 'Assignée', color: '#8b5cf6' },
  { key: 'IN_TRANSPORT', label: 'En transport', color: '#06b6d4' }, { key: 'START_DELIVERY', label: 'En livraison', color: '#f59e0b' },
  { key: 'DELIVERED', label: 'Livrée', color: '#16a34a' }, { key: 'NO_SHOW', label: 'NO_SHOW', color: '#6b7280' },
]

function Kpi({ label, value, sub, tone = 'default', icon: Icon }: { label: string; value: string | number; sub?: string; tone?: 'default' | 'red' | 'amber' | 'green'; icon?: React.ComponentType<{ className?: string }> }) {
  const c = { default: 'text-gray-900', red: 'text-red-600', amber: 'text-amber-600', green: 'text-green-600' }[tone]
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">{Icon && <Icon className="w-3.5 h-3.5" />}{label}</div>
      <div className={`text-2xl font-bold mt-1 ${c}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

export default function OperationsPage() {
  const [tab, setTab] = useState<Tab>('previsions')
  const [city, setCity] = useState('')
  const [day, setDay] = useState('tomorrow')
  const [perDriver, setPerDriver] = useState(3)
  const [heat, setHeat] = useState(false)
  const [forecast, setForecast] = useState<ForecastWithSpecial | null>(null)
  const [live, setLive] = useState<LiveResult | null>(null)
  const [hubsGeo, setHubsGeo] = useState<{ code: string; name: string; lat: number | null; lng: number | null }[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [updated, setUpdated] = useState<Date | null>(null)
  const [hubOpen, setHubOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const qs = new URLSearchParams(); if (city) qs.set('city', city)
      if (tab === 'previsions') {
        const f = new URLSearchParams(qs); f.set('day', day); f.set('perDriver', String(perDriver))
        const r = await fetch(`/api/ops/forecast?${f}`); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur'); setForecast(j)
      } else {
        const r = await fetch(`/api/ops/live?${qs}`); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur'); setLive(j)
      }
      setUpdated(new Date())
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erreur') } finally { setLoading(false) }
  }, [tab, city, day, perDriver])

  useEffect(() => { load() }, [load])
  usePolling(load, tab === 'previsions' ? 60_000 : 30_000) // rafraîchissement auto 30 s (live) / 60 s (prévisions) — onglet masqué = pause
  useEffect(() => { fetch('/api/ops/hubs').then(r => r.ok ? r.json() : null).then(j => j && setHubsGeo(j.hubs)).catch(() => {}) }, [])

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Activity className="w-5 h-5 text-purple-600" />Cockpit opérationnel</h1>
          <p className="text-sm text-gray-500">Anticipation et pilotage en temps réel — Marjane × E-Delivery</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={city} onChange={e => setCity(e.target.value)} className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
            {CITIES.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />{updated ? updated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Actualiser'}
          </button>
        </div>
      </div>

      <OpsNav />

      <div className="flex gap-1 border-b border-gray-200">
        {([['previsions', 'Prévisions par créneau', TrendingUp], ['live', 'Live par hub', Activity], ['carte', 'Carte & heatmap', Layers]] as const).map(([k, l, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-purple-600 text-purple-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <Icon className="w-4 h-4" />{l}
          </button>
        ))}
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{err}</div>}

      {tab === 'previsions' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-gray-300 overflow-hidden bg-white">
              {DAYS.map(d => <button key={d.v} onClick={() => setDay(d.v)} className={`px-3 py-1.5 text-sm ${day === d.v ? 'bg-purple-600 text-white' : 'hover:bg-gray-50'}`}>{d.l}</button>)}
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">Capacité / livreur / créneau
              <input type="number" min={1} max={20} value={perDriver} onChange={e => setPerDriver(Math.max(1, Number(e.target.value) || 1))} className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
            </label>
            {forecast && <span className="text-xs text-gray-400">{forecast.day} · basé sur {forecast.historyDays} jour(s) d&apos;historique</span>}
            {forecast?.specialDay && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700" title="Coefficient appliqué aux commandes prévues (Paramétrage → Calculs & équations → Jours spéciaux)">Jour spécial : {forecast.specialDay.label} ×{String(forecast.specialDay.factor).replace('.', ',')}</span>}
          </div>

          {forecast && <ForecastBoard forecast={forecast} perDriver={perDriver} resetKey={`${day}|${city}`} city={city} onApplied={load} />}
        </>
      )}

      {hubOpen && <HubDrawer hub={hubOpen} onClose={() => setHubOpen(null)} onChanged={load} />}

      {tab !== 'previsions' && live && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi label="Commandes du jour" value={live.totals.total} sub={live.totals.carriedOver ? `dont ${live.totals.carriedOver} reportées` : undefined} icon={Layers} />
            <Kpi label="Terminées" value={`${live.totals.pctDone}%`} sub={`${live.totals.done} / ${live.totals.total}`} tone="green" />
            <Kpi label="En retard" value={live.totals.late} tone={live.totals.late ? 'red' : 'green'} icon={AlertTriangle} />
            <Kpi label="À risque (< 45 min)" value={live.totals.atRisk} tone={live.totals.atRisk ? 'amber' : 'green'} icon={Clock} />
            <Kpi label="À dispatcher" value={live.totals.unassigned} tone={live.totals.unassigned ? 'amber' : 'green'} icon={Users} />
          </div>

          {tab === 'live' && (
            <>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                {live.hubs.map(h => (
                  <button key={h.code} onClick={() => setHubOpen(h.code)} className={`text-left bg-white border rounded-xl p-4 hover:shadow-md hover:border-purple-300 transition ${h.late ? 'border-red-300' : 'border-gray-200'}`}>
                    <div className="flex justify-between items-start">
                      <div><div className="font-semibold text-gray-900">{h.name}</div><div className="text-xs text-gray-400">{h.city} · {h.drivers} livreurs</div></div>
                      <div className="text-right"><div className="text-xl font-bold text-gray-900">{h.total}</div><div className="text-[10px] text-gray-400">commandes</div></div>
                    </div>
                    <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 mt-3">
                      {STATUS_META.map(s => h.byStatus[s.key] ? <div key={s.key} title={`${s.label}: ${h.byStatus[s.key]}`} style={{ width: `${(h.byStatus[s.key] / h.total) * 100}%`, background: s.color }} /> : null)}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[11px] text-gray-500">
                      {STATUS_META.filter(s => h.byStatus[s.key]).map(s => <span key={s.key} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label} {h.byStatus[s.key]}</span>)}
                    </div>
                    <div className="flex gap-2 mt-3 text-xs">
                      <span className={`px-2 py-0.5 rounded-full ${h.late ? 'bg-red-100 text-red-700 font-semibold' : 'bg-gray-100 text-gray-500'}`}>{h.late} en retard</span>
                      <span className={`px-2 py-0.5 rounded-full ${h.atRisk ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{h.atRisk} à risque</span>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{h.onTimeRate == null ? '—' : `${h.onTimeRate}% à l'heure`}</span>
                      {h.byStatus.READY_PICKUP ? <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{h.byStatus.READY_PICKUP} à dispatcher</span> : null}
                    </div>
                    <div className="text-[11px] text-purple-600 mt-2">Cliquer pour dispatcher / voir le détail →</div>
                  </button>
                ))}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                <div className="p-3 text-sm font-medium text-gray-700 border-b border-gray-100">Charge livreurs</div>
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-500 text-left"><th className="p-2 pl-3 font-medium">Livreur</th><th className="p-2 font-medium">Hub</th><th className="p-2 font-medium">En cours</th><th className="p-2 font-medium">En retard</th><th className="p-2 font-medium">Livrées</th></tr></thead>
                  <tbody>
                    {live.drivers.map(d => (
                      <tr key={d.code} className="border-t border-gray-100">
                        <td className="p-2 pl-3">{d.name} <span className="text-xs text-gray-400">{d.code}</span></td><td className="p-2 text-gray-500">{d.hubCode}</td>
                        <td className="p-2">{d.active}</td><td className={`p-2 ${d.late ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{d.late}</td><td className="p-2 text-green-700">{d.done}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'carte' && (
            <>
              <div className="flex items-center gap-4 text-xs text-gray-600">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={heat} onChange={e => setHeat(e.target.checked)} />Heatmap</label>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-600" />en retard</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />en cours</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-600" />à dispatcher</span>
                <span className="text-gray-400">{live.points.length} commandes actives</span>
              </div>
              <LiveMap points={live.points} hubs={hubsGeo} heat={heat} />
            </>
          )}
        </>
      )}
    </div>
  )
}
