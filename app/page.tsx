'use client'
// Dashboard — Analytique : périodes, tendances et comparaisons hub / créneau / livreur.
// Source UNIQUE : données temps réel (rapport LIVE = copie de OpsOrder, via /api/dashboard/kpis) + /api/ops/forecast.
// Le suivi minute par minute (statuts en cours, retards, carte) reste dans le Cockpit live (/operations).
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { BarChart3, RefreshCw, Wifi, WifiOff, Activity, TrendingUp, ArrowRight } from 'lucide-react'
import { addDays, localToday } from '@/lib/tz'
import { KpiCards } from './kpis/components/KpiCards'
import { ChartByDay } from './kpis/components/ChartByDay'
import { ChartByCreneau } from './kpis/components/ChartByCreneau'
import { ChartStatusPie } from './kpis/components/ChartStatusPie'
import { ChartOnTimePie } from './kpis/components/ChartOnTimePie'
import { DeliveryPipeline } from './kpis/components/DeliveryPipeline'
import { BestWorstDay } from './kpis/components/BestWorstDay'

interface Kpis {
  totalOrders: number; delivered: number; noShow: number; deliveryRate: number; onTimeRate: number
  totalCOD: number; avgOrdersPerDay: number; avgCODPerOrder: number
  timing: { orderToAssign: number; assignToTransport: number; transportToStart: number; startToDelivered: number; totalDuration: number }
  byCreneau: Array<{ creneau: string; total: number; delivered: number; noShow: number; deliveryRate: number; onTimeRate: number; avgDuration: number }>
  byLivreur: Array<{ name: string; total: number; delivered: number; noShow: number; deliveryRate: number; onTimeRate: number; avgDuration: number; totalCOD: number }>
  byHub: Array<{ hubName: string; hubCity: string; total: number; delivered: number; deliveryRate: number; avgDuration: number; totalCOD: number }>
  byDay: Array<{ date: string; total: number; delivered: number; noShow: number; totalCOD: number; avgDuration: number; deliveryRate: number }>
  statusDistribution: Array<{ name: string; value: number; color: string }>
  onTimeDistribution: Array<{ name: string; value: number; color: string }>
  bestDay: { date: string; volume: number; avgDuration: number } | null
  worstDay: { date: string; volume: number; avgDuration: number } | null
}

const PERIODS = [
  { key: '7',   label: '7 jours',  days: 7 },
  { key: '30',  label: '30 jours', days: 30 },
  { key: '90',  label: '90 jours', days: 90 },
  { key: 'all', label: 'Tout',     days: 0 },
] as const

const REFRESH_MS = 5 * 60_000 // la synchro back-office tourne toutes les 5 minutes

const rateCls = (r: number) => (r >= 90 ? 'text-green-600' : r >= 75 ? 'text-orange-500' : 'text-red-600')

function Delta({ cur, prev, unit = 'pp', invert = false }: { cur: number; prev?: number; unit?: string; invert?: boolean }) {
  if (prev === undefined) return <span className="text-gray-300">—</span>
  const d = Math.round((cur - prev) * 10) / 10
  if (d === 0) return <span className="text-gray-400 text-xs">=</span>
  const good = invert ? d < 0 : d > 0
  return <span className={`text-xs font-semibold ${good ? 'text-green-600' : 'text-red-500'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d)} {unit}</span>
}

function SectionTitle({ children, to, toLabel }: { children: React.ReactNode; to?: string; toLabel?: string }) {
  return (
    <div className="flex items-center justify-between p-4 border-b">
      <h3 className="font-semibold text-gray-900">{children}</h3>
      {to && <Link href={to} className="text-xs text-blue-600 hover:underline flex items-center gap-1">{toLabel} <ArrowRight className="h-3 w-3" /></Link>}
    </div>
  )
}

async function loadKpis(from: string | null, to: string | null): Promise<Kpis | null> {
  const p = new URLSearchParams({ preset: 'all' })
  if (from && to) { p.set('dateFrom', from); p.set('dateTo', to) }
  const res = await fetch(`/api/dashboard/kpis?${p}`, { cache: 'no-store' })
  if (!res.ok) return null
  return (await res.json()) as Kpis
}

export default function DashboardAnalytiquePage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('30')
  const [compare, setCompare] = useState(true)
  const [cur, setCur] = useState<Kpis | null>(null)
  const [prev, setPrev] = useState<Kpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [ok, setOk] = useState(true)
  const [updated, setUpdated] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const days = PERIODS.find(p => p.key === period)!.days
      const today = localToday()
      const from = days ? addDays(today, -(days - 1)) : null
      const to = days ? today : null
      const [c, p] = await Promise.all([
        loadKpis(from, to),
        days && compare ? loadKpis(addDays(today, -(2 * days - 1)), addDays(today, -days)) : Promise.resolve(null),
      ])
      setCur(c); setPrev(p); setOk(!!c); setUpdated(new Date())
    } catch {
      setOk(false)
    } finally {
      setLoading(false)
    }
  }, [period, compare])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const canCompare = period !== 'all'
  const prevHub = new Map((prev?.byHub ?? []).map(h => [h.hubName, h]))
  const prevCren = new Map((prev?.byCreneau ?? []).map(c => [c.creneau, c]))
  const prevLiv = new Map((prev?.byLivreur ?? []).map(l => [l.name, l]))
  const livreurs = (cur?.byLivreur ?? []).filter(l => l.total >= 10)
  const top = [...livreurs].sort((a, b) => b.deliveryRate - a.deliveryRate).slice(0, 5)
  const bottom = [...livreurs].sort((a, b) => a.deliveryRate - b.deliveryRate).slice(0, 5)

  return (
    <div className="min-h-screen bg-gray-50 p-3 md:p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-4 lg:space-y-6">

        {/* En-tête */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 lg:h-10 lg:w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 shadow">
              <BarChart3 className="h-4 w-4 lg:h-5 lg:w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg lg:text-xl font-bold text-gray-900">Dashboard — Analytique</h1>
              <p className="text-xs lg:text-sm text-gray-500">Périodes, tendances et comparaisons · données temps réel</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {ok ? <><Wifi className="h-3.5 w-3.5" /> Temps réel</> : <><WifiOff className="h-3.5 w-3.5" /> Indisponible</>}
            </div>
            {updated && <span className="text-xs text-gray-400">Mis à jour à {updated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
            </button>
            <Link href="/operations" className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700">
              <Activity className="h-3.5 w-3.5" /> Voir dans Cockpit live
            </Link>
          </div>
        </div>

        {/* Période + comparaison */}
        <div className="flex items-center gap-3 flex-wrap rounded-xl border border-gray-200 bg-white p-3">
          <span className="text-sm font-semibold text-gray-600">Période :</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={`px-3 py-2 text-xs font-medium transition ${period === p.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{p.label}</button>
            ))}
          </div>
          <label className={`flex items-center gap-2 text-xs font-medium ${canCompare ? 'text-gray-700 cursor-pointer' : 'text-gray-300'}`}>
            <input type="checkbox" className="accent-blue-600" checked={compare && canCompare} disabled={!canCompare} onChange={e => setCompare(e.target.checked)} />
            Comparer à la période précédente
          </label>
          <span className="text-xs text-gray-400 ml-auto hidden md:inline">
            En cours aujourd&apos;hui : statuts, retards, carte → <Link href="/operations" className="text-purple-600 hover:underline">Cockpit live</Link>
          </span>
        </div>

        {loading && !cur && (
          <div className="flex items-center justify-center py-12 gap-3 text-gray-500">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <span className="text-sm font-medium">Calcul des indicateurs...</span>
          </div>
        )}

        {!loading && !cur && (
          <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-center">
            <p className="text-sm text-red-700 font-medium">Impossible de charger les données temps réel.</p>
            <button onClick={load} className="mt-2 text-sm text-red-600 underline">Réessayer</button>
          </div>
        )}

        {cur && (
          <div className="space-y-4 lg:space-y-6">
            <KpiCards kpis={cur} previousData={prev && compare ? prev : undefined} />

            <ChartByDay data={cur.byDay} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ChartStatusPie data={cur.statusDistribution} title="Distribution des statuts" />
              <ChartOnTimePie data={cur.onTimeDistribution} onTimeRate={cur.onTimeRate} />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <DeliveryPipeline timing={cur.timing} />
              <BestWorstDay best={cur.bestDay} worst={cur.worstDay} />
            </div>

            {/* Comparaison par hub */}
            <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
              <SectionTitle to="/hubs" toLabel="Performance hubs">Comparaison par hub</SectionTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Hub</th><th className="px-4 py-2 text-right">Commandes</th>
                      <th className="px-4 py-2 text-right">Taux livraison</th><th className="px-4 py-2 text-right">Δ période préc.</th>
                      <th className="px-4 py-2 text-right">Durée moy.</th><th className="px-4 py-2 text-right">COD (MAD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cur.byHub.map(h => {
                      const p = compare ? prevHub.get(h.hubName) : undefined
                      return (
                        <tr key={h.hubName} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-800">{h.hubName}</td>
                          <td className="px-4 py-2 text-right">{h.total.toLocaleString('fr-FR')}</td>
                          <td className={`px-4 py-2 text-right font-semibold ${rateCls(h.deliveryRate)}`}>{h.deliveryRate}%</td>
                          <td className="px-4 py-2 text-right"><Delta cur={h.deliveryRate} prev={p?.deliveryRate} /></td>
                          <td className="px-4 py-2 text-right text-gray-600">{h.avgDuration} min</td>
                          <td className="px-4 py-2 text-right text-violet-700">{Math.round(h.totalCOD).toLocaleString('fr-MA')}</td>
                        </tr>
                      )
                    })}
                    {cur.byHub.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Aucune donnée sur la période</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Comparaison par créneau */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ChartByCreneau data={cur.byCreneau} />
              <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                <SectionTitle to="/performance/analyse" toLabel="Analyse détaillée">Comparaison par créneau</SectionTitle>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Créneau</th><th className="px-4 py-2 text-right">Cmd</th>
                      <th className="px-4 py-2 text-right">Ponctualité</th><th className="px-4 py-2 text-right">Δ préc.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cur.byCreneau.filter(c => c.total > 0).map(c => {
                      const p = compare ? prevCren.get(c.creneau) : undefined
                      return (
                        <tr key={c.creneau} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-800">{c.creneau}</td>
                          <td className="px-4 py-2 text-right">{c.total}</td>
                          <td className={`px-4 py-2 text-right font-semibold ${rateCls(c.onTimeRate)}`}>{c.onTimeRate}%</td>
                          <td className="px-4 py-2 text-right"><Delta cur={c.onTimeRate} prev={p?.onTimeRate} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Livreurs : meilleurs / à surveiller */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {([['Meilleurs livreurs', top, 'text-green-700'], ['Livreurs à surveiller', bottom, 'text-red-600']] as const).map(([title, rows, cls]) => (
                <div key={title} className="rounded-xl border bg-white shadow-sm overflow-hidden">
                  <SectionTitle to="/livreurs" toLabel="Tous les livreurs">{title} <span className="text-xs font-normal text-gray-400">(≥ 10 commandes)</span></SectionTitle>
                  <div className="divide-y divide-gray-100">
                    {rows.map(l => (
                      <div key={l.name} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{l.name}</p>
                          <p className="text-xs text-gray-500">{l.delivered}/{l.total} livrées · NO_SHOW {l.noShow}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${cls}`}>{l.deliveryRate}%</p>
                          <Delta cur={l.deliveryRate} prev={compare ? prevLiv.get(l.name)?.deliveryRate : undefined} />
                        </div>
                      </div>
                    ))}
                    {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-gray-400">Pas assez de données</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <PrevisionsMini />

        {/* Accès aux analyses détaillées */}
        <div className="flex flex-wrap gap-2 text-xs">
          {[['/kpis', 'KPIs & Métriques'], ['/hubs', 'Hubs'], ['/retours', 'Retours'], ['/livreurs', 'Livreurs & Score IA'], ['/previsions', 'Prévisions'], ['/rapports', 'Rapports planifiés'], ['/performance/analyse', 'Metrics']].map(([href, label]) => (
            <Link key={href} href={href} className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-gray-600 hover:bg-gray-50">{label}</Link>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Prévisions J+1 · J+2 · J+3 — même source que /previsions et le Cockpit : /api/ops/forecast ─────
function PrevisionsMini() {
  const [days, setDays] = useState<Array<{ date: string; expected: number; known: number; gap: number; sat: number }>>([])

  useEffect(() => {
    let alive = true
    Promise.all([1, 2, 3].map(n => fetch(`/api/ops/forecast?day=%2B${n}`).then(r => (r.ok ? r.json() : null)).catch(() => null)))
      .then(rs => {
        if (!alive) return
        setDays(rs.filter(Boolean).map(f => ({ date: f.day as string, expected: f.summary.expected, known: f.summary.known, gap: f.summary.driversGap, sat: f.summary.saturatedCells })))
      })
    return () => { alive = false }
  }, [])

  if (days.length === 0) return null
  const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b">
        <TrendingUp className="h-5 w-5 text-blue-600" />
        <h3 className="font-semibold text-gray-900">Prévisions J+1 · J+2 · J+3</h3>
        <Link href="/previsions" className="ml-auto text-xs text-blue-600 hover:underline flex items-center gap-1">Détail <ArrowRight className="h-3 w-3" /></Link>
      </div>
      <div className="grid grid-cols-3 divide-x divide-gray-100">
        {days.map((f, i) => {
          const dow = new Date(f.date + 'T12:00:00Z').getUTCDay()
          return (
            <div key={f.date} className="p-4">
              <div className="text-xs font-semibold text-gray-500 mb-1">{i === 0 ? 'Demain' : `Dans ${i + 1}j`} · {DAY_LABELS[dow]}</div>
              <div className="text-2xl font-black text-gray-900 mb-1">{f.expected} <span className="text-sm font-normal text-gray-400">cmd prévues</span></div>
              <div className="text-xs text-gray-500">{f.known} déjà connues</div>
              <span className={`mt-2 inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full border ${f.gap > 0 || f.sat > 0 ? 'text-red-600 bg-red-50 border-red-200' : 'text-green-600 bg-green-50 border-green-200'}`}>
                {f.gap > 0 ? `${f.gap} livreur${f.gap > 1 ? 's' : ''} manquant${f.gap > 1 ? 's' : ''}` : 'Capacité OK'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
