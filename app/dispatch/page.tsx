'use client'
import { useState, useEffect, useCallback } from 'react'
import { Truck, CheckCircle2, XCircle, Clock, BarChart3, ChevronDown, ChevronUp } from 'lucide-react'

interface Report { id: string; filename: string }

interface OrderRow {
  id: string; ref: string; status: string; city: string
  cod: number; deadline: string | null; delivered: string | null
}

interface DriverDispatch {
  driverName: string; hub: string; total: number
  byStatus: { DELIVERED: number; NO_SHOW: number; READY_PICKUP: number; OTHER: number }
  pct: number; recent: OrderRow[]
}

interface DispatchData {
  drivers: DriverDispatch[]
  hubs: string[]
  totals: { total: number; DELIVERED: number; NO_SHOW: number; READY_PICKUP: number; OTHER: number }
}

const STATUS_STYLE: Record<string, string> = {
  DELIVERED:     'bg-green-100 text-green-800',
  NO_SHOW:       'bg-red-100 text-red-800',
  READY_PICKUP:  'bg-yellow-100 text-yellow-800',
  UNKNOWN:       'bg-gray-100 text-gray-500',
}
const STATUS_LABEL: Record<string, string> = {
  DELIVERED: 'Livré', NO_SHOW: 'NO_SHOW', READY_PICKUP: 'En attente',
  UNKNOWN: 'Autre', OTHER: 'Autre',
}

function ProgressBar({ pct, total, done }: { pct: number; total: number; done: number }) {
  const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs text-gray-500 w-16 text-right">{done}/{total} ({pct}%)</span>
    </div>
  )
}

export default function DispatchPage() {
  const [reports, setReports]   = useState<Report[]>([])
  const [reportId, setReportId] = useState('')
  const [hubFilter, setHubFilter] = useState('')
  const [data, setData]         = useState<DispatchData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/dashboard/reports').then(r => r.json()).then((rs: unknown) => {
      if (!Array.isArray(rs)) return
      setReports(rs as Report[])
      if (rs.length > 0) setReportId((rs[0] as Report).id)
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!reportId) return
    setLoading(true)
    try {
      const url = `/api/dispatch?reportId=${reportId}${hubFilter ? `&hub=${encodeURIComponent(hubFilter)}` : ''}`
      const res = await fetch(url)
      if (res.ok) setData(await res.json())
    } finally { setLoading(false) }
  }, [reportId, hubFilter])

  useEffect(() => { load() }, [load])

  const toggle = (name: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })

  const done = (data?.totals.DELIVERED ?? 0) + (data?.totals.NO_SHOW ?? 0)

  return (
    <div className="flex flex-col gap-4 lg:gap-6 p-3 md:p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="h-5 w-5 lg:h-6 lg:w-6 text-indigo-600" /> Dispatch Opérationnel
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">
            Vue par livreur — avancement des tournées en temps réel
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={reportId} onChange={e => setReportId(e.target.value)}
          >
            {reports.length === 0
              ? <option value="">Aucun rapport</option>
              : reports.map(r => <option key={r.id} value={r.id}>{r.filename}</option>)}
          </select>
          {data && data.hubs.length > 0 && (
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={hubFilter} onChange={e => setHubFilter(e.target.value)}
            >
              <option value="">Tous les hubs</option>
              {data.hubs.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total commandes', value: data.totals.total,        icon: <BarChart3 size={18} className="text-indigo-500" />, color: 'text-indigo-700' },
            { label: 'Livrées',          value: data.totals.DELIVERED,   icon: <CheckCircle2 size={18} className="text-green-500" />, color: 'text-green-700'  },
            { label: 'NO_SHOW',          value: data.totals.NO_SHOW,     icon: <XCircle size={18} className="text-red-500" />,       color: 'text-red-700'    },
            { label: 'En attente',        value: data.totals.READY_PICKUP + data.totals.OTHER, icon: <Clock size={18} className="text-yellow-500" />, color: 'text-yellow-700' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 lg:p-4 flex items-center gap-3">
              {c.icon}
              <div>
                <div className={`text-xl lg:text-2xl font-bold ${c.color}`}>{c.value}</div>
                <div className="text-[10px] lg:text-xs text-gray-500">{c.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Global progress */}
      {data && data.totals.total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-gray-700">Avancement global</span>
            <span className="text-gray-500">{done}/{data.totals.total} tournées terminées</span>
          </div>
          <ProgressBar pct={Math.round(done / data.totals.total * 100)} total={data.totals.total} done={done} />
        </div>
      )}

      {/* Empty / loading */}
      {loading && <div className="py-16 text-center text-gray-400">Chargement…</div>}
      {!loading && !data && (
        <div className="py-16 text-center text-gray-400">
          <Truck size={36} className="mx-auto mb-3 text-gray-300" />
          <p>Sélectionnez un rapport pour afficher les tournées</p>
        </div>
      )}

      {/* Driver cards */}
      {!loading && data && (
        <div className="space-y-3">
          {data.drivers.map(d => {
            const isOpen = expanded.has(d.driverName)
            const driverDone = d.byStatus.DELIVERED + d.byStatus.NO_SHOW
            return (
              <div key={d.driverName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Driver header */}
                <button
                  onClick={() => toggle(d.driverName)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="h-9 w-9 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-700 font-bold text-xs flex-shrink-0">
                    {d.driverName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 text-sm">{d.driverName}</div>
                    <div className="text-xs text-gray-400">{d.hub}</div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="hidden sm:flex gap-2 text-xs">
                      <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full">{d.byStatus.DELIVERED} livrées</span>
                      {d.byStatus.NO_SHOW > 0 && <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded-full">{d.byStatus.NO_SHOW} NO_SHOW</span>}
                      {d.byStatus.READY_PICKUP > 0 && <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">{d.byStatus.READY_PICKUP} en attente</span>}
                    </div>
                    <div className="w-24 hidden md:block">
                      <ProgressBar pct={d.pct} total={d.total} done={driverDone} />
                    </div>
                    {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </button>

                {/* Expanded orders */}
                {isOpen && (
                  <div className="border-t border-gray-100 px-4 py-3">
                    <p className="text-xs text-gray-400 mb-2">5 dernières commandes</p>
                    <div className="space-y-1.5">
                      {d.recent.map(o => (
                        <div key={o.id} className="flex items-center gap-3 text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${STATUS_STYLE[o.status] ?? STATUS_STYLE.UNKNOWN}`}>
                            {STATUS_LABEL[o.status] ?? o.status}
                          </span>
                          <span className="font-mono text-gray-600">{o.ref}</span>
                          <span className="text-gray-400">{o.city}</span>
                          {o.cod > 0 && <span className="text-purple-600 font-medium ml-auto">{o.cod.toLocaleString('fr-MA')} MAD</span>}
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 md:hidden">
                      <ProgressBar pct={d.pct} total={d.total} done={driverDone} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
