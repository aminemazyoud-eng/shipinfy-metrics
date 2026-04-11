'use client'
import { useState, useEffect, useCallback } from 'react'
import { MapPin, TrendingUp, TrendingDown, Package, Trophy } from 'lucide-react'

interface Hub {
  hubName: string; hubCity: string; total: number; delivered: number
  deliveryRate: number; avgDuration: number; totalCOD: number
}

interface KpisData { byHub: Hub[]; byLivreur: { name: string; deliveryRate: number; total: number }[] }

interface Report { id: string; filename: string; _count: { orders: number } }

const PRESETS = [
  { key: 'all', label: 'Tout' }, { key: 'month', label: 'Ce mois' },
  { key: 'week', label: 'Cette semaine' }, { key: 'today', label: "Aujourd'hui" },
]

function fmtMin(min: number) {
  if (min >= 60) return `${Math.round(min / 60 * 10) / 10}h`
  return `${min}min`
}

function RateBar({ rate, max = 100 }: { rate: number; max?: number }) {
  const pct = max > 0 ? (rate / max) * 100 : 0
  const color = rate >= 80 ? '#16a34a' : rate >= 60 ? '#d97706' : '#dc2626'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{rate.toFixed(1)}%</span>
    </div>
  )
}

function CODBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs text-gray-600">{Math.round(value).toLocaleString('fr-MA')} MAD</span>
    </div>
  )
}

export default function HubsPage() {
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

  const hubs      = data?.byHub ?? []
  const maxCOD    = Math.max(...hubs.map(h => h.totalCOD), 1)
  const bestHub   = hubs[0]
  const worstHub  = hubs.length > 1 ? hubs[hubs.length - 1] : null
  const avgRate   = hubs.length > 0 ? hubs.reduce((s, h) => s + h.deliveryRate, 0) / hubs.length : 0
  const totalCOD  = hubs.reduce((s, h) => s + h.totalCOD, 0)

  return (
    <div className="flex flex-col gap-4 lg:gap-6 p-3 md:p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MapPin className="h-5 w-5 lg:h-6 lg:w-6 text-blue-600" /> Performance Hubs
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">Comparaison des hubs · taux de livraison · COD · délais</p>
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
                className={`px-3 py-2 text-xs font-medium transition ${preset === p.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        {[
          { label: 'Hubs actifs',       value: hubs.length,         icon: <MapPin size={18} className="text-blue-500" /> },
          { label: 'Taux moy. livraison', value: `${avgRate.toFixed(1)}%`, icon: <TrendingUp size={18} className="text-green-500" /> },
          { label: 'Meilleur hub',      value: bestHub?.hubName ?? '—', icon: <Trophy size={18} className="text-yellow-500" /> },
          { label: 'Total COD hubs',    value: `${Math.round(totalCOD).toLocaleString('fr-MA')} MAD`, icon: <Package size={18} className="text-purple-500" /> },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
            {c.icon}
            <div>
              <div className="text-lg font-bold text-gray-900 truncate">{c.value}</div>
              <div className="text-xs text-gray-500">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Best / Worst spotlight */}
      {hubs.length >= 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Best hub */}
          {bestHub && (
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Trophy size={16} className="text-yellow-500" />
                <span className="font-semibold text-sm text-gray-900">🏆 Meilleur Hub</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">{bestHub.hubName}</div>
              <div className="text-sm text-gray-500 mb-3">{bestHub.hubCity}</div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-white rounded-lg p-2 border border-green-100">
                  <div className="text-lg font-bold text-green-700">{bestHub.deliveryRate.toFixed(1)}%</div>
                  <div className="text-xs text-gray-500">Livraison</div>
                </div>
                <div className="bg-white rounded-lg p-2 border border-green-100">
                  <div className="text-lg font-bold text-gray-900">{bestHub.total}</div>
                  <div className="text-xs text-gray-500">Commandes</div>
                </div>
                <div className="bg-white rounded-lg p-2 border border-green-100">
                  <div className="text-lg font-bold text-purple-700">{Math.round(bestHub.totalCOD / 1000)}K</div>
                  <div className="text-xs text-gray-500">MAD COD</div>
                </div>
              </div>
            </div>
          )}

          {/* Worst hub */}
          {worstHub && (
            <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl border border-red-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown size={16} className="text-red-500" />
                <span className="font-semibold text-sm text-gray-900">⚠️ À améliorer</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">{worstHub.hubName}</div>
              <div className="text-sm text-gray-500 mb-3">{worstHub.hubCity}</div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-white rounded-lg p-2 border border-red-100">
                  <div className="text-lg font-bold text-red-600">{worstHub.deliveryRate.toFixed(1)}%</div>
                  <div className="text-xs text-gray-500">Livraison</div>
                </div>
                <div className="bg-white rounded-lg p-2 border border-red-100">
                  <div className="text-lg font-bold text-gray-900">{worstHub.total}</div>
                  <div className="text-xs text-gray-500">Commandes</div>
                </div>
                <div className="bg-white rounded-lg p-2 border border-red-100">
                  <div className="text-lg font-bold text-purple-700">{Math.round(worstHub.totalCOD / 1000)}K</div>
                  <div className="text-xs text-gray-500">MAD COD</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-gray-400">Chargement…</div>
      ) : hubs.length === 0 ? (
        <div className="py-16 text-center text-gray-400">Aucune donnée disponible</div>
      ) : (
        <>
          {/* Hub cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {hubs.map((h, i) => (
              <div key={h.hubName} className={`bg-white rounded-xl border p-5 ${i === 0 ? 'border-yellow-300 shadow-md' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {i === 0 && <span>🏆</span>}
                      <span className="font-bold text-gray-900">{h.hubName}</span>
                    </div>
                    {h.hubCity && <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1"><MapPin size={10} />{h.hubCity}</div>}
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${h.deliveryRate >= 80 ? 'bg-green-100 text-green-700' : h.deliveryRate >= 60 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                    #{i + 1}
                  </span>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-500">Taux livraison</span>
                      <span className="text-gray-700 font-medium">{h.delivered}/{h.total}</span>
                    </div>
                    <RateBar rate={h.deliveryRate} />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-500">COD total</span>
                    </div>
                    <CODBar value={h.totalCOD} max={maxCOD} />
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-xs">
                  <div className="text-center">
                    <div className="font-bold text-gray-900">{h.total}</div>
                    <div className="text-gray-400">Total</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-green-700">{h.delivered}</div>
                    <div className="text-gray-400">Livrées</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-red-600">{h.total - h.delivered}</div>
                    <div className="text-gray-400">Non livrées</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-gray-700">{fmtMin(h.avgDuration)}</div>
                    <div className="text-gray-400">Durée moy.</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Full comparison table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Tableau comparatif complet</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['#','Hub','Ville','Total','Livrées','Taux livraison','Durée moy.','COD Total'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {hubs.map((h, i) => (
                    <tr key={h.hubName} className={i === 0 ? 'bg-yellow-50' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3 font-bold text-gray-400 text-xs">{i === 0 ? '🏆' : `#${i + 1}`}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{h.hubName}</td>
                      <td className="px-4 py-3 text-gray-500">{h.hubCity || '—'}</td>
                      <td className="px-4 py-3">{h.total}</td>
                      <td className="px-4 py-3 text-green-700 font-medium">{h.delivered}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${h.deliveryRate >= 80 ? 'bg-green-100 text-green-800' : h.deliveryRate >= 60 ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}`}>
                          {h.deliveryRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{fmtMin(h.avgDuration)}</td>
                      <td className="px-4 py-3 font-medium text-purple-700">{h.totalCOD.toLocaleString('fr-MA')} MAD</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
