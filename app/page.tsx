'use client'
import { useState, useEffect, useCallback } from 'react'
import { Activity, Package, Truck, CheckCircle, XCircle, DollarSign, Users, RefreshCw, Wifi, WifiOff } from 'lucide-react'

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
  hubStats: Array<{
    name: string
    total: number
    delivered: number
    inTransit: number
    rate: number
  }>
  updatedAt: string
}

const POLL_INTERVAL_MS = 30_000 // 30 secondes

const STATUS_CONFIG = {
  IN_TRANSIT:       { label: 'En transit',       color: 'bg-blue-100 text-blue-800' },
  OUT_FOR_DELIVERY: { label: 'En livraison',      color: 'bg-orange-100 text-orange-800' },
  DELIVERED:        { label: 'Livré',             color: 'bg-green-100 text-green-800' },
  NO_SHOW:          { label: 'NO_SHOW',           color: 'bg-red-100 text-red-800' },
  PENDING:          { label: 'En attente',        color: 'bg-gray-100 text-gray-700' },
}

const DRIVER_STATUS_CONFIG = {
  active:     { label: 'Actif',      dot: 'bg-green-500' },
  delivering: { label: 'En livraison', dot: 'bg-orange-500 animate-pulse' },
  returning:  { label: 'Retour',     dot: 'bg-blue-500' },
  idle:       { label: 'Inactif',    dot: 'bg-gray-400' },
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  color: string
}) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm font-medium text-gray-700">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function RealtimePage() {
  const [data, setData] = useState<LiveStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [countdown, setCountdown] = useState(POLL_INTERVAL_MS / 1000)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/realtime')
      if (!res.ok) throw new Error()
      const json = await res.json() as LiveStats
      setData(json)
      setConnected(true)
      setLastUpdate(new Date())
      setCountdown(POLL_INTERVAL_MS / 1000)
    } catch {
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + polling every 30s
  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchData])

  // Countdown timer
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(c => c > 0 ? c - 1 : POLL_INTERVAL_MS / 1000)
    }, 1000)
    return () => clearInterval(tick)
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="text-gray-500 text-sm">Chargement des données temps réel...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 shadow">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Dashboard Temps Réel</h1>
              <p className="text-sm text-gray-500">Mise à jour automatique toutes les 30 secondes</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Connection status */}
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {connected
                ? <><Wifi className="h-3.5 w-3.5" /> Connecté</>
                : <><WifiOff className="h-3.5 w-3.5" /> Déconnecté</>
              }
            </div>
            {/* Countdown */}
            <div className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh dans {countdown}s
            </div>
            {/* Last update */}
            {lastUpdate && (
              <span className="text-xs text-gray-400">
                Mis à jour à {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            {/* Manual refresh */}
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
          <span className="font-semibold">Mode démo</span> — Données simulées. Connectez l&apos;API back-office via la variable d&apos;environnement <code className="bg-amber-100 px-1 rounded text-xs">BACKOFFICE_API_URL</code> pour des données réelles.
        </div>

        {data && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard
                icon={<Package className="h-5 w-5 text-blue-600" />}
                label="Commandes aujourd'hui"
                value={data.totalOrdersToday}
                color="bg-blue-50"
              />
              <StatCard
                icon={<Truck className="h-5 w-5 text-orange-500" />}
                label="En cours"
                value={data.ordersInTransit}
                sub="en transit"
                color="bg-orange-50"
              />
              <StatCard
                icon={<CheckCircle className="h-5 w-5 text-green-600" />}
                label="Livrées"
                value={data.ordersDelivered}
                color="bg-green-50"
              />
              <StatCard
                icon={<XCircle className="h-5 w-5 text-red-600" />}
                label="NO_SHOW"
                value={data.ordersNoShow}
                color="bg-red-50"
              />
              <StatCard
                icon={<Activity className={`h-5 w-5 ${data.deliveryRateLive >= 85 ? 'text-green-600' : data.deliveryRateLive >= 70 ? 'text-orange-500' : 'text-red-600'}`} />}
                label="Taux livraison live"
                value={`${data.deliveryRateLive}%`}
                color={data.deliveryRateLive >= 85 ? 'bg-green-50' : data.deliveryRateLive >= 70 ? 'bg-orange-50' : 'bg-red-50'}
              />
              <StatCard
                icon={<DollarSign className="h-5 w-5 text-violet-600" />}
                label="COD collecté"
                value={`${data.codCollectedToday.toLocaleString('fr-MA')} MAD`}
                color="bg-violet-50"
              />
            </div>

            {/* Active drivers + hub stats */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

              {/* Livreurs actifs */}
              <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-600" />
                    <h3 className="font-semibold text-gray-900">Livreurs actifs</h3>
                  </div>
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                    {data.activeDrivers} actifs
                  </span>
                </div>
                <div className="divide-y divide-gray-50">
                  {data.drivers.map(driver => {
                    const sc = DRIVER_STATUS_CONFIG[driver.status]
                    const rate = driver.ordersToday > 0
                      ? Math.round((driver.ordersDelivered / driver.ordersToday) * 100)
                      : 0
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
                  {data.hubStats.map(hub => (
                    <div key={hub.name} className="px-4 py-3 hover:bg-gray-50">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-sm font-medium text-gray-900">{hub.name}</p>
                        <span className={`text-xs font-semibold ${hub.rate >= 85 ? 'text-green-600' : hub.rate >= 70 ? 'text-orange-500' : 'text-red-600'}`}>
                          {hub.rate}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-100">
                        <div
                          className={`h-1.5 rounded-full ${hub.rate >= 85 ? 'bg-green-500' : hub.rate >= 70 ? 'bg-orange-500' : 'bg-red-500'}`}
                          style={{ width: `${hub.rate}%` }}
                        />
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
            <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 p-4 border-b">
                <Package className="h-5 w-5 text-gray-600" />
                <h3 className="font-semibold text-gray-900">Commandes récentes</h3>
              </div>
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
                    {data.recentOrders.map(order => {
                      const sc = STATUS_CONFIG[order.status]
                      return (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs font-medium text-gray-700">{order.ref}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${sc.color}`}>
                              {sc.label}
                            </span>
                          </td>
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
            </div>
          </>
        )}
      </div>
    </div>
  )
}
