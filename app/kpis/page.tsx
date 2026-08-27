'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { BarChart3, Mail, Zap, Trash2, Package } from 'lucide-react'
import { UploadZone } from './components/UploadZone'
import { FilterBar, FilterState, DEFAULT_FILTERS } from './components/FilterBar'
import { KpiCards } from './components/KpiCards'
import { DeliveryPipeline } from './components/DeliveryPipeline'
import { ChartByDay } from './components/ChartByDay'
import { ChartByCreneau } from './components/ChartByCreneau'
import { ChartStatusPie } from './components/ChartStatusPie'
import { ChartOnTimePie } from './components/ChartOnTimePie'
import { ChartCODArea } from './components/ChartCODArea'
import { DeliveryHeatmap } from './components/DeliveryHeatmap'
import { LivreurTable } from './components/LivreurTable'
import { HubTable } from './components/HubTable'
import { BestWorstDay } from './components/BestWorstDay'
import { SendReportModal } from './components/SendReportModal'

interface Report {
  id: string
  filename: string
  uploadedAt: string
  _count: { orders: number }
}

interface KpisData {
  totalOrders: number
  delivered: number
  noShow: number
  readyPickup: number
  deliveryRate: number
  noShowRate: number
  onTimeCount: number
  onTimeRate: number
  lateCount: number
  totalCOD: number
  avgCODPerOrder: number
  avgOrdersPerDay: number
  avgOrdersPerMonth: number
  timing: {
    orderToAssign: number
    assignToTransport: number
    transportToStart: number
    startToDelivered: number
    totalDuration: number
  }
  byCreneau: Array<{
    creneau: string
    total: number
    delivered: number
    noShow: number
    deliveryRate: number
    onTimeRate: number
    avgDuration: number
  }>
  byLivreur: Array<{
    name: string
    rank: number
    total: number
    delivered: number
    noShow: number
    deliveryRate: number
    onTimeRate: number
    avgDuration: number
    totalCOD: number
  }>
  byHub: Array<{
    hubName: string
    hubCity: string
    total: number
    delivered: number
    deliveryRate: number
    avgDuration: number
    totalCOD: number
  }>
  byDay: Array<{
    date: string
    total: number
    delivered: number
    noShow: number
    totalCOD: number
    avgDuration: number
    deliveryRate: number
  }>
  byCity: Array<{ city: string; count: number }>
  statusDistribution: Array<{ name: string; value: number; color: string }>
  onTimeDistribution: Array<{ name: string; value: number; color: string }>
  bestDay: { date: string; volume: number; avgDuration: number } | null
  worstDay: { date: string; volume: number; avgDuration: number } | null
  bestHub: { name: string; deliveryRate: number } | null
  bestLivreur: { name: string; deliveryRate: number; avgDuration: number } | null
  heatmapPoints: [number, number, number][]
  noShowLocations: Array<{ lat: number; lng: number; firstName?: string; lastName?: string; ref?: string }>
  hubLocations: Array<{ name: string; lat: number; lng: number }>
}

type CompareMode = 'off' | 'week' | 'month'

interface KpiBasic {
  totalOrders: number; delivered: number; noShow: number; deliveryRate: number
  onTimeRate: number; totalCOD: number; avgOrdersPerDay: number; avgCODPerOrder: number
}

type KpiMode = 'standard' | 'express'

interface ExpressReportRow {
  id: string
  filename: string
  uploadedAt: string
  totalRows: number
  storeType: string | null
}

interface ExpressKpis {
  totalOrders: number
  delivered: number
  cancelled: number
  pending: number
  picked: number
  slaRespected: number
  slaRate: number
  avgPickingTime: number
  avgDeliveryTime: number
  avgTotalTime: number
  byDriver: Array<{ driverName: string; delivered: number; slaRate: number; avgTime: number }>
  byPicker: Array<{ pickerId: string; ordersHandled: number; avgPickingTime: number }>
  bySla: {
    supermarket: { slaRate: number; avgTime: number; count: number }
    hypermarket: { slaRate: number; avgTime: number; count: number }
  }
}

const MODE_KEY = 'shipinfy_kpi_mode'

export default function KpisPage() {
  const [mode, setMode] = useState<KpiMode>('standard')

  // ── Standard state ──────────────────────────────────────────────────────────
  const [activeReport, setActiveReport] = useState<Report | null>(null)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [kpis, setKpis] = useState<KpisData | null>(null)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [compareMode, setCompareMode] = useState<CompareMode>('off')
  const [prevKpis, setPrevKpis] = useState<KpiBasic | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Express state ───────────────────────────────────────────────────────────
  const [expressReports, setExpressReports] = useState<ExpressReportRow[]>([])
  const [expressActive, setExpressActive] = useState<Report | null>(null)
  const [expressKpis, setExpressKpis] = useState<ExpressKpis | null>(null)
  const [expressLoading, setExpressLoading] = useState(false)

  // ── Persisted mode ─────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY)
      if (saved === 'express' || saved === 'standard') setMode(saved)
    } catch { /* */ }
  }, [])

  const changeMode = useCallback((m: KpiMode) => {
    setMode(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* */ }
  }, [])

  // ── Standard: load active report ───────────────────────────────────────────
  useEffect(() => {
    fetch('/api/dashboard/reports')
      .then(r => r.json())
      .then((reports: Report[]) => { if (Array.isArray(reports) && reports.length > 0) setActiveReport(reports[0]) })
      .catch(() => {})
  }, [])

  const fetchKpis = useCallback(async (reportId: string, f: FilterState) => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ reportId, preset: f.preset })
      if (f.dateFrom) p.set('dateFrom', f.dateFrom)
      if (f.dateTo)   p.set('dateTo',   f.dateTo)
      if (f.selectedCreneaux.length > 0)  p.set('creneaux', f.selectedCreneaux.join(','))
      if (f.selectedHubs.length > 0)      p.set('hubs',     f.selectedHubs.join(','))
      if (f.selectedLivreurs.length > 0)  p.set('livreurs', f.selectedLivreurs.join(','))
      const res = await fetch(`/api/dashboard/kpis?${p}`)
      setKpis(await res.json() as KpisData)
    } catch {
      setKpis(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPrevKpis = useCallback(async (reportId: string, f: FilterState, cmode: CompareMode) => {
    if (cmode === 'off') { setPrevKpis(null); return }
    try {
      const offset = cmode === 'week' ? 7 : 30
      const p = new URLSearchParams({ reportId, preset: f.preset, compare: 'true', reportOffset: String(offset) })
      if (f.dateFrom) p.set('dateFrom', f.dateFrom)
      if (f.dateTo)   p.set('dateTo',   f.dateTo)
      if (f.selectedCreneaux.length > 0)  p.set('creneaux', f.selectedCreneaux.join(','))
      if (f.selectedHubs.length > 0)      p.set('hubs',     f.selectedHubs.join(','))
      if (f.selectedLivreurs.length > 0)  p.set('livreurs', f.selectedLivreurs.join(','))
      const res = await fetch(`/api/dashboard/kpis?${p}`)
      if (res.ok) setPrevKpis(await res.json() as KpiBasic)
      else setPrevKpis(null)
    } catch { setPrevKpis(null) }
  }, [])

  useEffect(() => {
    if (!activeReport) { setKpis(null); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchKpis(activeReport.id, filters)
      fetchPrevKpis(activeReport.id, filters, compareMode)
    }, 300)
  }, [activeReport, filters, fetchKpis, fetchPrevKpis, compareMode])

  // ── Express: load report list + KPIs ───────────────────────────────────────
  const loadExpressReports = useCallback(async () => {
    try {
      const rows = await fetch('/api/express/reports').then(r => r.json()) as ExpressReportRow[]
      if (Array.isArray(rows)) {
        setExpressReports(rows)
        if (rows.length > 0) {
          setExpressActive(prev => prev ?? {
            id: rows[0].id,
            filename: rows[0].filename,
            uploadedAt: rows[0].uploadedAt,
            _count: { orders: rows[0].totalRows },
          })
        } else {
          setExpressActive(null)
        }
      }
    } catch { /* */ }
  }, [])

  useEffect(() => {
    if (mode === 'express') loadExpressReports()
  }, [mode, loadExpressReports])

  const fetchExpressKpis = useCallback(async (reportId: string) => {
    setExpressLoading(true)
    try {
      const res = await fetch(`/api/express/kpis?reportId=${reportId}`)
      if (res.ok) setExpressKpis(await res.json() as ExpressKpis)
      else setExpressKpis(null)
    } catch {
      setExpressKpis(null)
    } finally {
      setExpressLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mode !== 'express') return
    if (!expressActive) { setExpressKpis(null); return }
    fetchExpressKpis(expressActive.id)
  }, [mode, expressActive, fetchExpressKpis])

  const deleteExpressReport = useCallback(async (id: string) => {
    try {
      await fetch(`/api/express/reports?reportId=${id}`, { method: 'DELETE' })
      setExpressActive(prev => (prev?.id === id ? null : prev))
      if (expressActive?.id === id) setExpressKpis(null)
      await loadExpressReports()
    } catch { /* */ }
  }, [expressActive, loadExpressReports])

  const hubs    = kpis?.byHub.map(h => h.hubName) ?? []
  const sprints = kpis?.byLivreur.map(l => l.name) ?? []

  return (
    <div className="min-h-screen bg-gray-50 p-3 md:p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-4 lg:space-y-6">

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 lg:h-10 lg:w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 shadow">
              <BarChart3 className="h-4 w-4 lg:h-5 lg:w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg lg:text-xl font-bold text-gray-900">KPIs & Métriques</h1>
              <p className="text-xs lg:text-sm text-gray-500 hidden md:block">Analyse des performances de livraison</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {mode === 'standard' && (
              <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs">
                {([['off','Désactivé'],['week','J−7'],['month','Mois préc.']] as [CompareMode,string][]).map(([k, label]) => (
                  <button key={k} onClick={() => setCompareMode(k)}
                    className={`px-3 py-2 font-medium transition ${compareMode === k ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {mode === 'standard' && activeReport && kpis && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 lg:px-4 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm min-h-[44px]"
            >
              <Mail className="h-4 w-4" />
              <span className="hidden sm:inline">Envoyer le rapport</span>
              <span className="sm:hidden">Rapport</span>
            </button>
          )}
        </div>

        {/* ── Mode selector ── */}
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
          <span className="text-sm font-semibold text-gray-600">Mode :</span>
          <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
            mode === 'standard' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}>
            <input type="radio" name="kpi-mode" className="accent-blue-600"
              checked={mode === 'standard'} onChange={() => changeMode('standard')} />
            <BarChart3 className="h-4 w-4" /> Standard
          </label>
          <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
            mode === 'express' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}>
            <input type="radio" name="kpi-mode" className="accent-orange-600"
              checked={mode === 'express'} onChange={() => changeMode('express')} />
            <Zap className="h-4 w-4" /> Express
          </label>
        </div>

        {/* ═══════════════ STANDARD ═══════════════ */}
        {mode === 'standard' && (
          <>
            <UploadZone
              activeReport={activeReport}
              onUploadSuccess={r => setActiveReport(r)}
              onDeleteSuccess={() => { setActiveReport(null); setKpis(null) }}
            />

            {activeReport && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  Standard
                </span>
              </div>
            )}

            {activeReport && (
              <FilterBar filters={filters} onChange={setFilters} hubs={hubs} sprints={sprints} />
            )}

            {loading && (
              <div className="flex items-center justify-center py-8 gap-3 text-gray-500">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                <span className="text-sm font-medium">Calcul des KPIs...</span>
              </div>
            )}

            {kpis && !loading && (
              <div className="space-y-6">

                <KpiCards kpis={{
                  totalOrders:     kpis.totalOrders,
                  delivered:       kpis.delivered,
                  noShow:          kpis.noShow,
                  deliveryRate:    kpis.deliveryRate,
                  onTimeRate:      kpis.onTimeRate,
                  totalCOD:        kpis.totalCOD,
                  avgOrdersPerDay: kpis.avgOrdersPerDay,
                  avgCODPerOrder:  kpis.avgCODPerOrder,
                }} previousData={prevKpis ?? undefined} />

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <ChartStatusPie data={kpis.statusDistribution} title="Distribution des statuts" />
                  <ChartOnTimePie data={kpis.onTimeDistribution} onTimeRate={kpis.onTimeRate} />
                </div>

                <ChartByDay data={kpis.byDay} />

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <DeliveryPipeline timing={kpis.timing} />
                  <BestWorstDay best={kpis.bestDay} worst={kpis.worstDay} />
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <ChartByCreneau data={kpis.byCreneau} />
                  <ChartCODArea data={kpis.byDay} />
                </div>

                <div className="grid grid-cols-1">
                  <DeliveryHeatmap
                    totalOrders={kpis.totalOrders}
                    data={{
                      heatmapPoints:   kpis.heatmapPoints,
                      noShowLocations: kpis.noShowLocations,
                      hubLocations:    kpis.hubLocations,
                    }}
                  />
                </div>

                <LivreurTable data={kpis.byLivreur} />
                {kpis.byHub.length > 0 && <HubTable data={kpis.byHub} />}

              </div>
            )}

            {!activeReport && !loading && (
              <div className="py-20 text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100">
                  <BarChart3 className="h-10 w-10 text-gray-300" />
                </div>
                <p className="text-lg font-semibold text-gray-700">Importez un fichier Excel pour commencer</p>
                <p className="mt-1 text-sm text-gray-400">Les KPIs et graphiques s&apos;afficheront automatiquement</p>
              </div>
            )}
          </>
        )}

        {/* ═══════════════ EXPRESS ═══════════════ */}
        {mode === 'express' && (
          <>
            <UploadZone
              mode="express"
              activeReport={expressActive}
              onUploadSuccess={r => { setExpressActive(r); loadExpressReports() }}
              onDeleteSuccess={() => { setExpressActive(null); setExpressKpis(null); loadExpressReports() }}
            />

            {expressActive && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700">
                  Express
                </span>
              </div>
            )}

            {/* Report list */}
            {expressReports.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="mb-3 text-sm font-semibold text-gray-700">Rapports Express importés</p>
                <div className="space-y-2">
                  {expressReports.map(r => (
                    <div key={r.id}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                        expressActive?.id === r.id ? 'border-orange-300 bg-orange-50' : 'border-gray-200'
                      }`}>
                      <button
                        onClick={() => setExpressActive({
                          id: r.id, filename: r.filename, uploadedAt: r.uploadedAt,
                          _count: { orders: r.totalRows },
                        })}
                        className="flex items-center gap-2 text-left"
                      >
                        <Package className="h-4 w-4 text-orange-500" />
                        <span className="font-medium text-gray-800">{r.filename}</span>
                        <span className="text-xs text-gray-400">
                          {r.totalRows.toLocaleString('fr-FR')} lignes
                          {r.storeType ? ` · ${r.storeType}` : ''}
                          {' · '}{new Date(r.uploadedAt).toLocaleDateString('fr-MA')}
                        </span>
                      </button>
                      <button
                        onClick={() => deleteExpressReport(r.id)}
                        className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {expressLoading && (
              <div className="flex items-center justify-center py-8 gap-3 text-gray-500">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-600 border-t-transparent" />
                <span className="text-sm font-medium">Calcul des KPIs Express...</span>
              </div>
            )}

            {expressKpis && !expressLoading && (
              <div className="space-y-6">
                {/* Cards */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                  {[
                    { label: 'Taux SLA', value: `${expressKpis.slaRate}%`, color: 'text-orange-600', bg: 'bg-orange-50' },
                    { label: 'Picking moy.', value: `${expressKpis.avgPickingTime} min`, color: 'text-blue-600', bg: 'bg-blue-50' },
                    { label: 'Livraison moy.', value: `${expressKpis.avgDeliveryTime} min`, color: 'text-indigo-600', bg: 'bg-indigo-50' },
                    { label: 'Total moy.', value: `${expressKpis.avgTotalTime} min`, color: 'text-purple-600', bg: 'bg-purple-50' },
                    { label: 'Commandes', value: expressKpis.totalOrders, color: 'text-gray-700', bg: 'bg-gray-50' },
                    { label: 'Livrées', value: expressKpis.delivered, color: 'text-green-600', bg: 'bg-green-50' },
                    { label: 'Annulées', value: expressKpis.cancelled, color: 'text-red-600', bg: 'bg-red-50' },
                  ].map(c => (
                    <div key={c.label} className={`${c.bg} rounded-xl p-3`}>
                      <p className={`text-xl font-black leading-none ${c.color}`}>{c.value}</p>
                      <p className="mt-1 text-[11px] text-gray-500">{c.label}</p>
                    </div>
                  ))}
                </div>

                {/* bySla comparison */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="mb-3 text-sm font-semibold text-gray-700">Comparaison SLA par type de magasin</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {([['supermarket','Supermarché'],['hypermarket','Hypermarché']] as const).map(([k, label]) => {
                      const b = expressKpis.bySla[k]
                      return (
                        <div key={k} className="rounded-lg border border-gray-200 p-3">
                          <p className="text-sm font-semibold text-gray-800">{label}</p>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                            <div><p className="text-lg font-bold text-orange-600">{b.slaRate}%</p><p className="text-[10px] text-gray-500">SLA</p></div>
                            <div><p className="text-lg font-bold text-purple-600">{b.avgTime}</p><p className="text-[10px] text-gray-500">min moy.</p></div>
                            <div><p className="text-lg font-bold text-gray-700">{b.count}</p><p className="text-[10px] text-gray-500">commandes</p></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* byDriver */}
                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                  <p className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700">Performance par livreur</p>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                      <tr>
                        <th className="px-4 py-2 text-left">Livreur</th>
                        <th className="px-4 py-2 text-right">Livrées</th>
                        <th className="px-4 py-2 text-right">Taux SLA</th>
                        <th className="px-4 py-2 text-right">Temps moyen (min)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expressKpis.byDriver.map(d => (
                        <tr key={d.driverName} className="border-t border-gray-100">
                          <td className="px-4 py-2 font-medium text-gray-800">{d.driverName}</td>
                          <td className="px-4 py-2 text-right">{d.delivered}</td>
                          <td className="px-4 py-2 text-right">{d.slaRate}%</td>
                          <td className="px-4 py-2 text-right">{d.avgTime}</td>
                        </tr>
                      ))}
                      {expressKpis.byDriver.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400">Aucune donnée</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* byPicker */}
                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                  <p className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700">Performance par picker</p>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                      <tr>
                        <th className="px-4 py-2 text-left">Picker</th>
                        <th className="px-4 py-2 text-right">Commandes traitées</th>
                        <th className="px-4 py-2 text-right">Picking moyen (min)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expressKpis.byPicker.map(p => (
                        <tr key={p.pickerId} className="border-t border-gray-100">
                          <td className="px-4 py-2 font-medium text-gray-800">{p.pickerId}</td>
                          <td className="px-4 py-2 text-right">{p.ordersHandled}</td>
                          <td className="px-4 py-2 text-right">{p.avgPickingTime}</td>
                        </tr>
                      ))}
                      {expressKpis.byPicker.length === 0 && (
                        <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-400">Aucune donnée</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!expressActive && !expressLoading && (
              <div className="py-20 text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-orange-50">
                  <Zap className="h-10 w-10 text-orange-300" />
                </div>
                <p className="text-lg font-semibold text-gray-700">Importez un fichier Express pour commencer</p>
                <p className="mt-1 text-sm text-gray-400">Les KPIs Express (SLA, picking, livraison) s&apos;afficheront automatiquement</p>
              </div>
            )}
          </>
        )}
      </div>

      {mode === 'standard' && activeReport && kpis && (
        <SendReportModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          reportId={activeReport.id}
          filters={filters as unknown as Record<string, unknown>}
          kpisData={kpis}
        />
      )}
    </div>
  )
}
