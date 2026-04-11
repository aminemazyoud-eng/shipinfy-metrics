'use client'
import { useState, useEffect, useCallback } from 'react'
import { XCircle, TrendingUp, Clock, MapPin, Users, Building2 } from 'lucide-react'

interface Livreur {
  name: string; noShow: number; total: number; deliveryRate: number
}
interface Hub {
  hubName: string; hubCity: string; total: number; delivered: number; deliveryRate: number
}
interface Creneau {
  creneau: string; total: number; noShow: number; deliveryRate: number
}
interface DayData {
  date: string; total: number; noShow: number; deliveryRate: number
}
interface KpisData {
  totalOrders: number; noShow: number; noShowRate: number; deliveryRate: number
  byLivreur: Livreur[]; byHub: Hub[]; byCreneau: Creneau[]; byDay: DayData[]
}
interface Report { id: string; filename: string; _count: { orders: number } }

const PRESETS = [
  { key: 'all', label: 'Tout' }, { key: 'month', label: 'Ce mois' },
  { key: 'week', label: 'Cette semaine' }, { key: 'today', label: "Aujourd'hui" },
]

function Bar({ value, max, color = '#ef4444' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="text-xs text-gray-600 w-8 text-right">{value}</span>
    </div>
  )
}

export default function RetoursPage() {
  const [data, setData]         = useState<KpisData | null>(null)
  const [reports, setReports]   = useState<Report[]>([])
  const [reportId, setReportId] = useState('')
  const [preset, setPreset]     = useState('all')
  const [loading, setLoading]   = useState(false)

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
      const res = await fetch(`/api/dashboard/kpis?reportId=${reportId}&preset=${preset}`)
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [reportId, preset])

  useEffect(() => { load() }, [load])

  const livreursWithNoShow = (data?.byLivreur ?? [])
    .filter(l => l.noShow > 0)
    .sort((a, b) => b.noShow - a.noShow)

  const hubsWithNoShow = (data?.byHub ?? [])
    .map(h => ({ ...h, noShow: h.total - h.delivered }))
    .filter(h => h.noShow > 0)
    .sort((a, b) => b.noShow - a.noShow)

  const creneauxWithNoShow = (data?.byCreneau ?? [])
    .filter(c => c.noShow > 0)
    .sort((a, b) => b.noShow - a.noShow)

  const maxLivreurNoShow = Math.max(...livreursWithNoShow.map(l => l.noShow), 1)
  const maxHubNoShow     = Math.max(...hubsWithNoShow.map(h => h.noShow), 1)
  const maxCrNoShow      = Math.max(...creneauxWithNoShow.map(c => c.noShow), 1)

  // Trend: last 7 days
  const last7 = (data?.byDay ?? []).slice(-7)

  const worstDayNoShow = [...(data?.byDay ?? [])].sort((a, b) => b.noShow - a.noShow)[0]
  const worstLivreur   = livreursWithNoShow[0]
  const worstHub       = hubsWithNoShow[0]
  const worstCreneau   = creneauxWithNoShow[0]

  return (
    <div className="flex flex-col gap-4 lg:gap-6 p-3 md:p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <XCircle className="h-5 w-5 lg:h-6 lg:w-6 text-red-500" /> Retours & NO_SHOW
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">Analyse approfondie des non-livraisons — par livreur, hub, créneau</p>
        </div>
        <div className="flex gap-2 flex-wrap">
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
                className={`px-3 py-2 text-xs font-medium transition ${preset === p.key ? 'bg-red-500 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        {[
          { label: 'Total NO_SHOW',      value: data?.noShow ?? 0, color: 'text-red-600',    bg: 'bg-red-50',    icon: <XCircle size={18} className="text-red-500" /> },
          { label: 'Taux NO_SHOW',       value: `${(data?.noShowRate ?? 0).toFixed(1)}%`, color: 'text-orange-600', bg: 'bg-orange-50', icon: <TrendingUp size={18} className="text-orange-500" /> },
          { label: 'Livreurs concernés', value: livreursWithNoShow.length, color: 'text-blue-600',  bg: 'bg-blue-50',   icon: <Users size={18} className="text-blue-500" /> },
          { label: 'Hubs concernés',     value: hubsWithNoShow.length, color: 'text-purple-600', bg: 'bg-purple-50', icon: <Building2 size={18} className="text-purple-500" /> },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-xl border border-gray-200 p-4 flex items-center gap-3`}>
            {c.icon}
            <div>
              <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
              <div className="text-xs text-gray-500">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Insights row */}
      {(worstLivreur || worstHub || worstCreneau || worstDayNoShow) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Livreur critique', value: worstLivreur ? `${worstLivreur.name} (${worstLivreur.noShow} NS)` : '—', icon: '👤' },
            { label: 'Hub critique',     value: worstHub     ? `${worstHub.hubName} (${worstHub.noShow} NS)` : '—', icon: '📍' },
            { label: 'Créneau critique', value: worstCreneau ? `${worstCreneau.creneau} (${worstCreneau.noShow} NS)` : '—', icon: '🕐' },
            { label: 'Pire journée',     value: worstDayNoShow ? `${worstDayNoShow.date} (${worstDayNoShow.noShow} NS)` : '—', icon: '📅' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-red-100 p-3">
              <div className="text-lg mb-1">{c.icon}</div>
              <div className="text-xs text-gray-500 mb-0.5">{c.label}</div>
              <div className="text-xs font-semibold text-gray-800 truncate">{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-gray-400">Chargement…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* NO_SHOW par livreur */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Users size={14} className="text-red-500" />
              <span className="font-semibold text-sm text-gray-900">Par livreur</span>
              <span className="ml-auto text-xs text-gray-400">{livreursWithNoShow.length} livreurs</span>
            </div>
            <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
              {livreursWithNoShow.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">Aucun NO_SHOW</p>
              ) : livreursWithNoShow.map(l => (
                <div key={l.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-900 truncate flex-1 mr-2">{l.name}</span>
                    <span className="text-gray-500 flex-shrink-0">
                      {((l.noShow / l.total) * 100).toFixed(0)}% NS
                    </span>
                  </div>
                  <Bar value={l.noShow} max={maxLivreurNoShow} />
                </div>
              ))}
            </div>
          </div>

          {/* NO_SHOW par hub */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <MapPin size={14} className="text-red-500" />
              <span className="font-semibold text-sm text-gray-900">Par hub</span>
              <span className="ml-auto text-xs text-gray-400">{hubsWithNoShow.length} hubs</span>
            </div>
            <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
              {hubsWithNoShow.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">Aucun NO_SHOW</p>
              ) : hubsWithNoShow.map(h => (
                <div key={h.hubName}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-900 truncate flex-1 mr-2">{h.hubName}</span>
                    <span className="text-gray-500 flex-shrink-0">
                      {(100 - h.deliveryRate).toFixed(0)}% NS
                    </span>
                  </div>
                  <Bar value={h.noShow} max={maxHubNoShow} color="#f97316" />
                </div>
              ))}
            </div>
          </div>

          {/* NO_SHOW par créneau */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Clock size={14} className="text-red-500" />
              <span className="font-semibold text-sm text-gray-900">Par créneau</span>
            </div>
            <div className="p-4 space-y-3">
              {creneauxWithNoShow.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">Aucun NO_SHOW</p>
              ) : creneauxWithNoShow.map(c => (
                <div key={c.creneau}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-900">{c.creneau}</span>
                    <span className="text-gray-500">{((c.noShow / c.total) * 100).toFixed(0)}% NS</span>
                  </div>
                  <Bar value={c.noShow} max={maxCrNoShow} color="#a855f7" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Trend chart — 7 derniers jours */}
      {last7.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-sm text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp size={14} className="text-red-500" /> Évolution NO_SHOW — 7 derniers jours
          </h3>
          <div className="flex items-end gap-2 h-28">
            {last7.map(d => {
              const maxNS = Math.max(...last7.map(x => x.noShow), 1)
              const h = (d.noShow / maxNS) * 100
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-semibold text-red-600">{d.noShow}</span>
                  <div className="w-full flex justify-center">
                    <div
                      className="w-full rounded-t transition-all"
                      style={{ height: `${Math.max(h * 0.7, 4)}px`, background: d.noShow > 0 ? '#ef4444' : '#e5e7eb' }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 rotate-45 origin-left whitespace-nowrap" style={{ fontSize: '9px' }}>
                    {d.date.slice(5)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
