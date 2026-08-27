'use client'
import { useState, useEffect, useCallback } from 'react'
import { Package, RefreshCw, AlertTriangle, Info, Timer, CheckCircle2 } from 'lucide-react'

interface PickingOrder {
  id: string
  orderId: string
  pickerId: string | null
  pickingStatus: string
  pickingStartAt: string | null
  pickingEndAt: string | null
  elapsedMin: number
  slaTarget: number
  slaRemainingMin: number
  slaWarn: boolean
  driverName: string
  zone: string | null
}

interface PickerRank {
  pickerId: string
  handled: number
  avgPickingMin: number
  slaRate: number
}

interface PickingData {
  orders: PickingOrder[]
  kpis: { toPick: number; inProgress: number; ready: number; avgPickingMin: number }
  byPicker: PickerRank[]
  slaAlerts: PickingOrder[]
}

interface ExpressReport { id: string; filename: string; uploadedAt: string }

const STATUS_META: Record<string, { label: string; cls: string }> = {
  a_picker: { label: 'À picker',   cls: 'bg-gray-100 text-gray-600'    },
  en_cours: { label: 'En cours',   cls: 'bg-orange-100 text-orange-700' },
  pret:     { label: 'Prêt',       cls: 'bg-green-100 text-green-700'   },
  recupere: { label: 'Récupéré',   cls: 'bg-blue-100 text-blue-700'    },
}

const NEXT_ACTIONS: { status: string; label: string }[] = [
  { status: 'en_cours', label: 'Démarrer' },
  { status: 'pret',     label: 'Prêt' },
  { status: 'recupere', label: 'Récupéré' },
]

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('fr-MA', { hour: '2-digit', minute: '2-digit' })
}

export default function PickingPage() {
  const [expressMode, setExpressMode] = useState(true)
  const [reports, setReports]   = useState<ExpressReport[]>([])
  const [reportId, setReportId] = useState('')
  const [date, setDate]         = useState('')
  const [data, setData]         = useState<PickingData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [busy, setBusy]         = useState<string | null>(null)

  useEffect(() => {
    try {
      setExpressMode(localStorage.getItem('shipinfy_kpi_mode') === 'express')
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetch('/api/express/reports')
      .then(r => r.ok ? r.json() : [])
      .then((rs: unknown) => {
        if (Array.isArray(rs)) {
          setReports(rs as ExpressReport[])
          if (rs.length > 0) setReportId((rs[0] as ExpressReport).id)
        }
      })
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!reportId) { setData(null); return }
    setLoading(true)
    try {
      const url = `/api/picking?reportId=${reportId}${date ? `&date=${date}` : ''}`
      const res = await fetch(url)
      if (res.ok) setData(await res.json())
      else setData(null)
    } finally { setLoading(false) }
  }, [reportId, date])

  useEffect(() => { load() }, [load])

  const changeStatus = async (order: PickingOrder, status: string) => {
    setBusy(order.id)
    try {
      await fetch(`/api/picking/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await load()
    } finally { setBusy(null) }
  }

  const kpis = data?.kpis ?? { toPick: 0, inProgress: 0, ready: 0, avgPickingMin: 0 }

  return (
    <div className="p-3 md:p-4 lg:p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="h-5 w-5 lg:h-6 lg:w-6 text-blue-600" /> Picking Express
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">
            Suivi du picking en entrepôt — SLA temps réel & classement pickers
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={reportId}
            onChange={e => setReportId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {reports.length === 0 && <option value="">Aucun rapport Express</option>}
            {reports.map(r => (
              <option key={r.id} value={r.id}>{r.filename}</option>
            ))}
          </select>
          <input
            type="date" value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button onClick={load} className="p-2 text-gray-400 hover:text-blue-600" aria-label="Rafraîchir">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {!expressMode && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <Info size={16} className="flex-shrink-0 mt-0.5" />
          <span>Le module Picking est réservé au mode Express — activez-le dans KPIs &amp; Métriques.</span>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'À picker',    value: kpis.toPick,        color: 'text-gray-700',   bg: 'bg-gray-50'    },
          { label: 'En cours',    value: kpis.inProgress,    color: 'text-orange-700', bg: 'bg-orange-50' },
          { label: 'Prêts',       value: kpis.ready,         color: 'text-green-700',  bg: 'bg-green-50'  },
          { label: 'Temps moyen picking', value: `${kpis.avgPickingMin} min`, color: 'text-blue-700', bg: 'bg-blue-50' },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-xl border border-gray-200 p-3 lg:p-4`}>
            <div className={`text-xl lg:text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-[10px] lg:text-xs text-gray-500 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* SLA alerts */}
      {data && data.slaAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
            <AlertTriangle size={15} /> {data.slaAlerts.length} commande(s) proche(s) du dépassement SLA
          </div>
          <div className="mt-1 text-xs text-red-600">
            {data.slaAlerts.map(o => o.orderId).join(', ')}
          </div>
        </div>
      )}

      {/* Orders table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Order ID', 'Picker', 'Statut', 'Début', 'Fin', 'Écoulé', 'SLA restant', 'Actions'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Chargement…</td></tr>
              ) : !data || data.orders.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Aucune commande de picking</td></tr>
              ) : data.orders.map(o => {
                const meta = STATUS_META[o.pickingStatus] ?? STATUS_META.a_picker
                return (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 font-medium text-gray-900">{o.orderId}</td>
                    <td className="px-3 py-3 text-gray-500">{o.pickerId ?? '—'}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="px-3 py-3 text-gray-600">{fmtTime(o.pickingStartAt)}</td>
                    <td className="px-3 py-3 text-gray-600">{fmtTime(o.pickingEndAt)}</td>
                    <td className="px-3 py-3 text-gray-600 flex items-center gap-1">
                      <Timer size={12} className="text-gray-400" /> {o.elapsedMin} min
                    </td>
                    <td className="px-3 py-3">
                      {o.slaWarn ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 animate-pulse">
                          <AlertTriangle size={11} /> {o.slaRemainingMin} min
                        </span>
                      ) : (
                        <span className={`text-xs font-medium ${o.slaRemainingMin < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                          {o.slaRemainingMin} min
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {NEXT_ACTIONS.filter(a => a.status !== o.pickingStatus).map(a => (
                          <button
                            key={a.status}
                            onClick={() => changeStatus(o, a.status)}
                            disabled={busy === o.id}
                            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Picker ranking */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <CheckCircle2 size={15} className="text-blue-600" />
          <span className="text-sm font-semibold text-gray-800">Classement pickers</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Picker', 'Commandes traitées', 'Temps moyen', 'Taux SLA'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!data || data.byPicker.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">Aucun picker</td></tr>
              ) : data.byPicker.map(p => (
                <tr key={p.pickerId} className="hover:bg-gray-50">
                  <td className="px-3 py-3 font-medium text-gray-900">{p.pickerId}</td>
                  <td className="px-3 py-3 text-gray-600">{p.handled}</td>
                  <td className="px-3 py-3 text-gray-600">{p.avgPickingMin} min</td>
                  <td className="px-3 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.slaRate >= 80 ? 'bg-green-100 text-green-700' : p.slaRate >= 50 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-600'}`}>
                      {p.slaRate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
