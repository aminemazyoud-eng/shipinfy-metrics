'use client'
import { useState, useEffect, useCallback } from 'react'
import { Users, Trophy, TrendingDown, TrendingUp, Search, Filter, BarChart3 } from 'lucide-react'

interface Livreur {
  name: string; rank: number; total: number; delivered: number
  noShow: number; deliveryRate: number; onTimeRate: number
  avgDuration: number; totalCOD: number
}

interface KpisData { byLivreur: Livreur[] }

interface Report { id: string; filename: string; uploadedAt: string; _count: { orders: number } }

const PRESETS = [
  { key: 'all', label: 'Tout' }, { key: 'month', label: 'Ce mois' },
  { key: 'week', label: 'Cette semaine' }, { key: 'today', label: "Aujourd'hui" },
]

function fmtMin(min: number) {
  if (min >= 60) return `${Math.round(min / 60 * 10) / 10}h`
  return `${min}min`
}

function RateBadge({ rate }: { rate: number }) {
  const cls = rate >= 80 ? 'bg-green-100 text-green-800' : rate >= 60 ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{rate.toFixed(1)}%</span>
}

function RateBar({ rate, color = '#3b82f6' }: { rate: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(rate, 100)}%`, background: color }} />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right">{rate.toFixed(0)}%</span>
    </div>
  )
}

function MedalIcon({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-base">🥇</span>
  if (rank === 2) return <span className="text-base">🥈</span>
  if (rank === 3) return <span className="text-base">🥉</span>
  return <span className="text-xs font-bold text-gray-400">#{rank}</span>
}

export default function LivreursPage() {
  const [data, setData]       = useState<KpisData | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [reportId, setReportId] = useState('')
  const [preset, setPreset]   = useState('all')
  const [loading, setLoading] = useState(false)
  const [search, setSearch]   = useState('')
  const [sortBy, setSortBy]   = useState<'deliveryRate' | 'total' | 'totalCOD' | 'noShow'>('deliveryRate')
  const [view, setView]       = useState<'table' | 'cards'>('table')

  useEffect(() => {
    fetch('/api/dashboard/reports').then(r => r.json()).then((rs: Report[]) => {
      setReports(rs)
      if (rs.length > 0) setReportId(rs[0].id)
    })
  }, [])

  const load = useCallback(async () => {
    if (!reportId) return
    setLoading(true)
    try {
      const url = `/api/dashboard/kpis?reportId=${reportId}&preset=${preset}`
      const res = await fetch(url)
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [reportId, preset])

  useEffect(() => { load() }, [load])

  const livreurs = data?.byLivreur ?? []
  const filtered = livreurs
    .filter(l => l.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'deliveryRate') return b.deliveryRate - a.deliveryRate
      if (sortBy === 'total')        return b.total - a.total
      if (sortBy === 'totalCOD')     return b.totalCOD - a.totalCOD
      if (sortBy === 'noShow')       return b.noShow - a.noShow
      return 0
    })

  const top3     = [...livreurs].sort((a, b) => b.deliveryRate - a.deliveryRate).slice(0, 3)
  const bottom3  = [...livreurs].sort((a, b) => a.deliveryRate - b.deliveryRate).slice(0, 3)
  const avgRate  = livreurs.length > 0 ? livreurs.reduce((s, l) => s + l.deliveryRate, 0) / livreurs.length : 0
  const totalCOD = livreurs.reduce((s, l) => s + l.totalCOD, 0)

  return (
    <div className="flex flex-col gap-4 lg:gap-6 p-3 md:p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="h-5 w-5 lg:h-6 lg:w-6 text-blue-600" /> Performance Livreurs
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">Classement, analyse individuelle et détection des outliers</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={reportId}
            onChange={e => setReportId(e.target.value)}
          >
            {reports.map(r => <option key={r.id} value={r.id}>{r.filename}</option>)}
          </select>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`px-3 py-2 text-xs font-medium transition ${preset === p.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        {[
          { label: 'Livreurs actifs', value: livreurs.length, icon: <Users size={18} className="text-blue-500" /> },
          { label: 'Taux moy. livraison', value: `${avgRate.toFixed(1)}%`, icon: <BarChart3 size={18} className="text-green-500" /> },
          { label: 'Meilleur taux', value: top3[0] ? `${top3[0].deliveryRate.toFixed(1)}%` : '—', icon: <Trophy size={18} className="text-yellow-500" /> },
          { label: 'Total COD livreurs', value: `${Math.round(totalCOD).toLocaleString('fr-MA')} MAD`, icon: <TrendingUp size={18} className="text-purple-500" /> },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 lg:p-4 flex items-center gap-2 lg:gap-3">
            {c.icon}
            <div>
              <div className="text-lg lg:text-xl font-bold text-gray-900">{c.value}</div>
              <div className="text-[10px] lg:text-xs text-gray-500">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Top 3 / Bottom 3 */}
      {livreurs.length >= 3 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Top 3 */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={16} className="text-yellow-500" />
              <span className="font-semibold text-sm text-gray-900">Top 3 — Meilleur taux</span>
            </div>
            <div className="space-y-2">
              {top3.map((l, i) => (
                <div key={l.name} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-green-100">
                  <MedalIcon rank={i + 1} />
                  <span className="flex-1 text-sm font-medium text-gray-900 truncate">{l.name}</span>
                  <RateBadge rate={l.deliveryRate} />
                  <span className="text-xs text-gray-400">{l.total} cmd</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom 3 */}
          <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl border border-red-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown size={16} className="text-red-500" />
              <span className="font-semibold text-sm text-gray-900">À surveiller — Taux le plus bas</span>
            </div>
            <div className="space-y-2">
              {bottom3.map((l) => (
                <div key={l.name} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-red-100">
                  <span className="text-sm">⚠️</span>
                  <span className="flex-1 text-sm font-medium text-gray-900 truncate">{l.name}</span>
                  <RateBadge rate={l.deliveryRate} />
                  <span className="text-xs text-gray-400">{l.noShow} NO_SHOW</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search + sort + view toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Rechercher un livreur…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-400" />
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="deliveryRate">Trier : Taux livraison</option>
            <option value="total">Trier : Volume</option>
            <option value="totalCOD">Trier : COD</option>
            <option value="noShow">Trier : NO_SHOW</option>
          </select>
        </div>
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={() => setView('table')} className={`px-3 py-2 text-xs transition ${view === 'table' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Tableau</button>
          <button onClick={() => setView('cards')} className={`px-3 py-2 text-xs transition ${view === 'cards' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Cartes</button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400">Chargement des données…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-gray-400">Aucun livreur trouvé</div>
      ) : view === 'table' ? (
        /* TABLE VIEW */
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Rang','Livreur','Total','Livrées','NO_SHOW','Taux livraison','On-Time','Durée moy.','Total COD'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((l, i) => (
                  <tr key={l.name} className={l.rank <= 3 ? 'bg-yellow-50' : 'hover:bg-gray-50'}>
                    <td className="px-3 py-3"><MedalIcon rank={l.rank} /></td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-gray-900">{l.name}</div>
                      <RateBar rate={l.deliveryRate} color={l.deliveryRate >= 80 ? '#16a34a' : l.deliveryRate >= 60 ? '#d97706' : '#dc2626'} />
                    </td>
                    <td className="px-3 py-3 text-gray-700">{l.total}</td>
                    <td className="px-3 py-3 text-green-700 font-medium">{l.delivered}</td>
                    <td className="px-3 py-3 text-red-600">{l.noShow}</td>
                    <td className="px-3 py-3"><RateBadge rate={l.deliveryRate} /></td>
                    <td className="px-3 py-3"><RateBadge rate={l.onTimeRate} /></td>
                    <td className="px-3 py-3 text-gray-600">{fmtMin(l.avgDuration)}</td>
                    <td className="px-3 py-3 font-medium text-gray-900">{l.totalCOD.toLocaleString('fr-MA')} MAD</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* CARDS VIEW */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(l => (
            <div key={l.name} className={`bg-white rounded-xl border p-4 ${l.rank <= 3 ? 'border-yellow-300 shadow-md' : 'border-gray-200'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-sm">
                  {l.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">{l.name}</div>
                  <div className="flex items-center gap-1">
                    <MedalIcon rank={l.rank} />
                    <span className="text-xs text-gray-400">{l.total} commandes</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500">Taux livraison</span>
                    <RateBadge rate={l.deliveryRate} />
                  </div>
                  <RateBar rate={l.deliveryRate} color={l.deliveryRate >= 80 ? '#16a34a' : l.deliveryRate >= 60 ? '#d97706' : '#dc2626'} />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500">On-Time</span>
                    <span className="font-medium">{l.onTimeRate.toFixed(1)}%</span>
                  </div>
                  <RateBar rate={l.onTimeRate} color="#2563eb" />
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-2 text-center">
                <div><div className="text-xs text-gray-500">Livrées</div><div className="font-semibold text-green-700">{l.delivered}</div></div>
                <div><div className="text-xs text-gray-500">NO_SHOW</div><div className="font-semibold text-red-600">{l.noShow}</div></div>
                <div><div className="text-xs text-gray-500">Durée</div><div className="font-semibold text-gray-700">{fmtMin(l.avgDuration)}</div></div>
              </div>
              <div className="mt-2 text-center text-xs font-medium text-purple-600">{l.totalCOD.toLocaleString('fr-MA')} MAD COD</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
