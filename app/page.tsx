'use client'
import { useState, useEffect, useCallback, memo } from 'react'
import {
  Activity, Package, Truck, CheckCircle, XCircle,
  DollarSign, Users, RefreshCw, Wifi, WifiOff, TrendingUp,
} from 'lucide-react'

interface LiveDriver {
  id: string
  name: string
  status: 'active' | 'delivering' | 'returning' | 'idle'
  hub: string
  ordersToday: number
  ordersDelivered: number
}

interface LiveOrder {
  id: string
  ref: string
  status: 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'NO_SHOW' | 'PENDING'
  hub: string
  driver?: string
  creneau: string
  cod: number
}

interface LiveStats {
  totalOrdersToday: number
  ordersInTransit: number
  ordersDelivered: number
  ordersNoShow: number
  deliveryRateLive: number
  codCollectedToday: number
  activeDrivers: number
  drivers: LiveDriver[]
  recentOrders: LiveOrder[]
  hubStats: Array<{ name: string; total: number; delivered: number; inTransit: number; rate: number }>
  updatedAt: string
}

const POLL_INTERVAL_MS = 30_000
const FETCH_TIMEOUT_MS = 10_000 // 10s timeout

const STATUS_CONFIG = {
  IN_TRANSIT:       { label: 'En transit',  color: 'bg-blue-100 text-blue-800' },
  OUT_FOR_DELIVERY: { label: 'En livraison', color: 'bg-orange-100 text-orange-800' },
  DELIVERED:        { label: 'Livré',        color: 'bg-green-100 text-green-800' },
  NO_SHOW:          { label: 'NO_SHOW',      color: 'bg-red-100 text-red-800' },
  PENDING:          { label: 'En attente',   color: 'bg-gray-100 text-gray-700' },
}

const DRIVER_STATUS_CONFIG = {
  active:     { label: 'Actif',        dot: 'bg-green-500' },
  delivering: { label: 'En livraison', dot: 'bg-orange-500 animate-pulse' },
  returning:  { label: 'Retour',       dot: 'bg-blue-500' },
  idle:       { label: 'Inactif',      dot: 'bg-gray-400' },
}

// ─── Skeleton components ──────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="rounded-xl border bg-white p-3 lg:p-5 shadow-sm animate-pulse">
      <div className="mb-3 h-10 w-10 rounded-lg bg-gray-200" />
      <div className="mb-2 h-7 w-16 rounded bg-gray-200" />
      <div className="h-4 w-24 rounded bg-gray-100" />
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-4 py-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-2.5 w-2.5 rounded-full bg-gray-200" />
        <div>
          <div className="mb-1 h-4 w-28 rounded bg-gray-200" />
          <div className="h-3 w-20 rounded bg-gray-100" />
        </div>
      </div>
      <div className="text-right">
        <div className="mb-1 h-4 w-10 rounded bg-gray-200" />
        <div className="h-3 w-8 rounded bg-gray-100" />
      </div>
    </div>
  )
}

// ─── Memoized stat card ───────────────────────────────────────────────────────
const StatCard = memo(function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <div className="rounded-xl border bg-white p-3 lg:p-5 shadow-sm">
      <div className={`mb-2 lg:mb-3 flex h-8 w-8 lg:h-10 lg:w-10 items-center justify-center rounded-lg ${color}`}>
        {icon}
      </div>
      <p className="text-xl lg:text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs lg:text-sm font-medium text-gray-700">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
})

export default function RealtimePage() {
  const [data, setData]           = useState<LiveStats | null>(null)
  const [loading, setLoading]     = useState(true)
  const [connected, setConnected] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [countdown, setCountdown] = useState(POLL_INTERVAL_MS / 1000)

  const fetchData = useCallback(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch('/api/realtime', { signal: controller.signal, cache: 'no-store' })
      clearTimeout(timer)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const json = await res.json() as LiveStats
      setData(json)
      setConnected(true)
      setLastUpdate(new Date())
      setCountdown(POLL_INTERVAL_MS / 1000)
    } catch {
      clearTimeout(timer)
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchData])

  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(c => (c > 0 ? c - 1 : POLL_INTERVAL_MS / 1000))
    }, 1000)
    return () => clearInterval(tick)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 p-3 md:p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-4 lg:space-y-6">

        {/* Header — always visible */}
        <div className="flex items-center justify-between flex-wrap gap-3 lg:gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 lg:h-10 lg:w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 shadow">
              <Activity className="h-4 w-4 lg:h-5 lg:w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg lg:text-xl font-bold text-gray-900">Dashboard Temps Réel</h1>
              <p className="text-xs lg:text-sm text-gray-500">Mise à jour automatique toutes les 30 secondes</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {connected
                ? <><Wifi className="h-3.5 w-3.5" /> Connecté</>
                : <><WifiOff className="h-3.5 w-3.5" /> Déconnecté — <button onClick={fetchData} className="underline">Réessayer</button></>
              }
            </div>
            {!loading && (
              <div className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700">
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh dans {countdown}s
              </div>
            )}
            {lastUpdate && (
              <span className="text-xs text-gray-400">
                Mis à jour à {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Actualiser
            </button>
          </div>
        </div>

        {/* Mock data badge */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 flex items-center gap-2 text-sm text-amber-700">
          <span className="font-semibold">Mode démo</span> — Données simulées. Connectez l&apos;API back-office via <code className="bg-amber-100 px-1 rounded text-xs">BACKOFFICE_API_URL</code> pour des données réelles.
        </div>

        {/* KPI Cards — skeleton while loading */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6 lg:gap-4">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          ) : data ? (
            <>
              <StatCard icon={<Package className="h-5 w-5 text-blue-600" />}   label="Commandes aujourd'hui" value={data.totalOrdersToday} color="bg-blue-50" />
              <StatCard icon={<Truck className="h-5 w-5 text-orange-500" />}   label="En cours"              value={data.ordersInTransit}  sub="en transit"  color="bg-orange-50" />
              <StatCard icon={<CheckCircle className="h-5 w-5 text-green-600" />} label="Livrées"             value={data.ordersDelivered}  color="bg-green-50" />
              <StatCard icon={<XCircle className="h-5 w-5 text-red-600" />}    label="NO_SHOW"               value={data.ordersNoShow}     color="bg-red-50" />
              <StatCard
                icon={<Activity className={`h-5 w-5 ${data.deliveryRateLive >= 85 ? 'text-green-600' : data.deliveryRateLive >= 70 ? 'text-orange-500' : 'text-red-600'}`} />}
                label="Taux livraison live"
                value={`${data.deliveryRateLive}%`}
                color={data.deliveryRateLive >= 85 ? 'bg-green-50' : data.deliveryRateLive >= 70 ? 'bg-orange-50' : 'bg-red-50'}
              />
              <StatCard icon={<DollarSign className="h-5 w-5 text-violet-600" />} label="COD collecté" value={`${data.codCollectedToday.toLocaleString('fr-MA')} MAD`} color="bg-violet-50" />
            </>
          ) : (
            <div className="col-span-6 rounded-xl border border-red-100 bg-red-50 p-6 text-center">
              <p className="text-sm text-red-700 font-medium">Impossible de charger les données.</p>
              <button onClick={fetchData} className="mt-2 text-sm text-red-600 underline">Réessayer</button>
            </div>
          )}
        </div>

        {/* Livreurs + Hubs */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Livreurs actifs */}
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold text-gray-900">Livreurs actifs</h3>
              </div>
              {data && (
                <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                  {data.activeDrivers} actifs
                </span>
              )}
            </div>
            <div className="divide-y divide-gray-50">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                : data?.drivers.map(driver => {
                    const sc = DRIVER_STATUS_CONFIG[driver.status]
                    const rate = driver.ordersToday > 0 ? Math.round((driver.ordersDelivered / driver.ordersToday) * 100) : 0
                    return (
                      <div key={driver.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                        <div className="flex items-center gap-3">
                          <span className={`h-2.5 w-2.5 rounded-full ${sc.dot} shrink-0`} />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{driver.name}</p>
                            <p className="text-xs text-gray-500">{driver.hub} · {sc.label}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-900">{driver.ordersDelivered}/{driver.ordersToday}</p>
                          <p className={`text-xs font-medium ${rate >= 85 ? 'text-green-600' : rate >= 70 ? 'text-orange-500' : 'text-red-600'}`}>{rate}%</p>
                        </div>
                      </div>
                    )
                  })}
            </div>
          </div>

          {/* Hub stats */}
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b">
              <Activity className="h-5 w-5 text-purple-600" />
              <h3 className="font-semibold text-gray-900">Performance par Hub</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {loading
                ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
                : data?.hubStats.map(hub => (
                    <div key={hub.name} className="px-4 py-3 hover:bg-gray-50">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-sm font-medium text-gray-900">{hub.name}</p>
                        <span className={`text-xs font-semibold ${hub.rate >= 85 ? 'text-green-600' : hub.rate >= 70 ? 'text-orange-500' : 'text-red-600'}`}>
                          {hub.rate}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-100">
                        <div className={`h-1.5 rounded-full ${hub.rate >= 85 ? 'bg-green-500' : hub.rate >= 70 ? 'bg-orange-500' : 'bg-red-500'}`} style={{ width: `${hub.rate}%` }} />
                      </div>
                      <div className="flex gap-3 mt-1 text-xs text-gray-400">
                        <span>{hub.total} total</span>
                        <span className="text-green-600">{hub.delivered} livrées</span>
                        <span className="text-blue-600">{hub.inTransit} en transit</span>
                      </div>
                    </div>
                  ))}
            </div>
          </div>
        </div>

        {/* Recent orders */}
        {(loading || data) && (
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b">
              <Package className="h-5 w-5 text-gray-600" />
              <h3 className="font-semibold text-gray-900">Commandes récentes</h3>
            </div>
            {loading ? (
              <div className="divide-y divide-gray-100">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-4 px-4 py-3 animate-pulse">
                    <div className="h-4 w-28 rounded bg-gray-200" />
                    <div className="h-4 w-20 rounded bg-gray-100" />
                    <div className="h-4 w-24 rounded bg-gray-100" />
                    <div className="h-4 w-20 rounded bg-gray-100" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Référence','Statut','Hub','Livreur','Créneau','COD'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data?.recentOrders.map(order => {
                      const sc = STATUS_CONFIG[order.status]
                      return (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs font-medium text-gray-700">{order.ref}</td>
                          <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${sc.color}`}>{sc.label}</span></td>
                          <td className="px-4 py-3 text-gray-600">{order.hub}</td>
                          <td className="px-4 py-3 text-gray-600">{order.driver ?? '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{order.creneau}</td>
                          <td className="px-4 py-3 font-medium text-violet-700">{order.cod} MAD</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Prévisions J+1 ─────────────────────────────────────────────── */}
        <PrevisionsMini />

      </div>
    </div>
  )
}

// ── Section prévisions J+1 ────────────────────────────────────────────────────
function PrevisionsMini() {
  const [forecast, setForecast] = useState<Array<{date:string;vol:number;rate:number;risk:string}>>([])

  useEffect(() => {
    fetch('/api/previsions')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.forecast) setForecast(d.forecast.slice(0, 3)) })
      .catch(() => {})
  }, [])

  if (forecast.length === 0) return null

  const RISK_COLOR: Record<string, string> = {
    low:    'text-green-600 bg-green-50 border-green-200',
    medium: 'text-orange-600 bg-orange-50 border-orange-200',
    high:   'text-red-600 bg-red-50 border-red-200',
  }
  const RISK_LABEL: Record<string, string> = { low: 'Faible', medium: 'Moyen', high: 'Élevé' }
  const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b">
        <TrendingUp className="h-5 w-5 text-blue-600" />
        <h3 className="font-semibold text-gray-900">Prévisions J+1 · J+2 · J+3</h3>
        <span className="ml-auto text-xs text-gray-400">Modèle ML interne</span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-gray-100">
        {forecast.map((f, i) => {
          const dow = new Date(f.date).getDay()
          const label = i === 0 ? 'Demain' : i === 1 ? 'Dans 2j' : 'Dans 3j'
          const riskCls = RISK_COLOR[f.risk] ?? RISK_COLOR.low
          return (
            <div key={f.date} className="p-4">
              <div className="text-xs font-semibold text-gray-500 mb-1">{label} · {DAY_LABELS[dow]}</div>
              <div className="text-2xl font-black text-gray-900 mb-1">{f.vol} <span className="text-sm font-normal text-gray-400">cmd</span></div>
              <div className="text-sm text-blue-600 font-semibold mb-2">{f.rate}% livraison prévue</div>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${riskCls}`}>
                Risque {RISK_LABEL[f.risk]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
