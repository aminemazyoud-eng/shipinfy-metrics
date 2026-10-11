'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { BarChart3, Mail } from 'lucide-react'
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

// 100 % temps réel : source unique = rapport LIVE (copie de OpsOrder) ; plus d'import Excel ni de mode Express importé.
const LIVE_REPORT_ID = 'live-ops'

export default function KpisPage() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [kpis, setKpis] = useState<KpisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [compareMode, setCompareMode] = useState<CompareMode>('off')
  const [prevKpis, setPrevKpis] = useState<KpiBasic | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const qs = (f: FilterState) => {
    const p = new URLSearchParams({ preset: f.preset })
    if (f.dateFrom) p.set('dateFrom', f.dateFrom)
    if (f.dateTo)   p.set('dateTo',   f.dateTo)
    if (f.selectedCreneaux.length > 0)  p.set('creneaux', f.selectedCreneaux.join(','))
    if (f.selectedHubs.length > 0)      p.set('hubs',     f.selectedHubs.join(','))
    if (f.selectedLivreurs.length > 0)  p.set('livreurs', f.selectedLivreurs.join(','))
    return p
  }

  const fetchKpis = useCallback(async (f: FilterState) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dashboard/kpis?${qs(f)}`, { cache: 'no-store' })
      setKpis(res.ok ? await res.json() as KpisData : null)
    } catch {
      setKpis(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPrevKpis = useCallback(async (f: FilterState, cmode: CompareMode) => {
    if (cmode === 'off') { setPrevKpis(null); return }
    try {
      const p = qs(f)
      p.set('compare', 'true'); p.set('reportOffset', String(cmode === 'week' ? 7 : 30))
      const res = await fetch(`/api/dashboard/kpis?${p}`)
      if (res.ok) setPrevKpis(await res.json() as KpiBasic)
      else setPrevKpis(null)
    } catch { setPrevKpis(null) }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchKpis(filters)
      fetchPrevKpis(filters, compareMode)
    }, 300)
  }, [filters, fetchKpis, fetchPrevKpis, compareMode])

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
              <p className="text-xs lg:text-sm text-gray-500 hidden md:block">Analyse des performances de livraison · données temps réel</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs">
              {([['off','Désactivé'],['week','J−7'],['month','Mois préc.']] as [CompareMode,string][]).map(([k, label]) => (
                <button key={k} onClick={() => setCompareMode(k)}
                  className={`px-3 py-2 font-medium transition ${compareMode === k ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {kpis && (
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

        <FilterBar filters={filters} onChange={setFilters} hubs={hubs} sprints={sprints} />

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

        {!kpis && !loading && (
          <div className="py-20 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100">
              <BarChart3 className="h-10 w-10 text-gray-300" />
            </div>
            <p className="text-lg font-semibold text-gray-700">Aucune commande temps réel sur cette période</p>
            <p className="mt-1 text-sm text-gray-400">Les KPIs se calculent automatiquement depuis les commandes du back-office</p>
          </div>
        )}
      </div>

      {kpis && (
        <SendReportModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          reportId={LIVE_REPORT_ID}
          filters={filters as unknown as Record<string, unknown>}
          kpisData={kpis}
        />
      )}
    </div>
  )
}
