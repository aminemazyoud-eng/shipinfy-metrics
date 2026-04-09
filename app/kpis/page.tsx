'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { BarChart3, Mail } from 'lucide-react'
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

export default function KpisPage() {
  const [activeReport, setActiveReport] = useState<Report | null>(null)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [kpis, setKpis] = useState<KpisData | null>(null)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/reports')
      .then(r => r.json())
      .then((reports: Report[]) => { if (reports.length > 0) setActiveReport(reports[0]) })
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

  useEffect(() => {
    if (!activeReport) { setKpis(null); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchKpis(activeReport.id, filters), 300)
  }, [activeReport, filters, fetchKpis])

  const hubs    = kpis?.byHub.map(h => h.hubName) ?? []
  const sprints = kpis?.byLivreur.map(l => l.name) ?? []

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 shadow">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">KPIs & Métriques — Tournées</h1>
              <p className="text-sm text-gray-500">Analyse des performances de livraison</p>
            </div>
          </div>
          {activeReport && kpis && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Mail className="h-4 w-4" />
              Envoyer le rapport
            </button>
          )}
        </div>

        <UploadZone
          activeReport={activeReport}
          onUploadSuccess={r => setActiveReport(r)}
          onDeleteSuccess={() => { setActiveReport(null); setKpis(null) }}
        />

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
            }} />

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
      </div>

      {activeReport && kpis && (
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
