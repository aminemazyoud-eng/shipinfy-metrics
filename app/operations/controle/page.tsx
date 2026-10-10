'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Radar, RefreshCw, AlertTriangle, Info, Truck } from 'lucide-react'
import OpsNav from '../components/OpsNav'
import FleetMap, { type FleetVehicle, type FleetHub } from '../components/FleetMap'
import { usePolling } from '@/lib/use-polling'

interface Stop { orderId: string; ref: string; seq: number; status: string; etaAt: string | null; slotEnd: string; lat: number | null; lng: number | null; late: boolean; lateMin: number; etaLateMin: number; postponedCount: number; district: string | null }
interface Tour { id: string; driverCode: string; driverName: string; hubCode: string | null; rotation: number; status: string; total: number; done: number; remaining: number; progressPct: number; nextEtaAt: string | null; lastEtaAt: string | null; lateStops: number; etaLateStops: number; stops: Stop[] }
interface Alert { id: string; kind: string; severity: 'critical' | 'warning' | 'info'; driverCode: string | null; message: string }
interface Res { day: string; serverTime: string; positionWindowMin: number; etaNote: string; trafficLive: boolean; vehicles: FleetVehicle[]; tours: Tour[]; alerts: Alert[]; alertsTotal: number; totals: { tours: number; ongoing: number; done: number; stops: number; stopsDone: number; late: number; atRiskEta: number; online: number }; unplanned: number; unassigned: number }

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' }) : '—')
const STATUS: Record<string, string> = { PLANNED: 'Planifiée', LOADING: 'Chargement', ONGOING: 'En cours', DONE: 'Terminée' }
const KIND: Record<string, string> = { slot_late: 'Retard de créneau', delivery_risk: 'Risque de non-livraison', no_signal: 'Sans position', geo_outside: 'Hors rayon' }
const SEV: Record<string, string> = { critical: 'border-red-300 bg-red-50 text-red-800', warning: 'border-amber-300 bg-amber-50 text-amber-800', info: 'border-blue-200 bg-blue-50 text-blue-800' }

export default function ControlePage() {
  const [day, setDay] = useState('today')
  const [hub, setHub] = useState('')
  const [hubs, setHubs] = useState<FleetHub[]>([])
  const [res, setRes] = useState<Res | null>(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<string | null>(null)

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ day }); if (hub) qs.set('hub', hub)
    const r = await fetch(`/api/ops/fleet-live?${qs}`)
    if (r.ok) { setRes(await r.json()); setErr('') } else setErr(r.status === 401 ? 'Session expirée' : 'Données indisponibles')
  }, [day, hub])
  useEffect(() => { load() }, [load])
  usePolling(load, 15_000)
  useEffect(() => { fetch('/api/ops/hubs').then(r => r.ok ? r.json() : null).then(j => j && setHubs(j.hubs)).catch(() => {}) }, [])

  const selTour = useMemo(() => res?.tours.find(t => t.id === sel) ?? null, [res, sel])
  const mapHubs = useMemo(() => hubs.filter(h => !hub || h.code === hub), [hubs, hub])
  const T = res?.totals

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Radar className="w-5 h-5 text-purple-600" />Tour de contrôle</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select value={day} onChange={e => setDay(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"><option value="today">Aujourd&apos;hui</option><option value="tomorrow">Demain</option><option value="-1">Hier</option></select>
          <select value={hub} onChange={e => setHub(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"><option value="">Tous les hubs</option>{hubs.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}</select>
          <button onClick={load} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 flex items-center gap-1"><RefreshCw className="w-4 h-4" />Actualiser</button>
        </div>
      </div>
      <OpsNav />
      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{err}</div>}

      {T && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {[['Tournées', `${T.ongoing} en cours / ${T.tours}`, ''], ['Livraisons', `${T.stopsDone} / ${T.stops}`, ''], ['Véhicules en ligne', String(T.online), T.online < T.ongoing ? 'text-amber-700' : ''], ['En retard', String(T.late), T.late ? 'text-red-700' : ''], ['Risque (ETA)', String(T.atRiskEta), T.atRiskEta ? 'text-amber-700' : ''], ['Non planifiées', String(res?.unplanned ?? 0), res?.unplanned ? 'text-amber-700' : '']].map(([l, v, c]) => (
            <div key={l} className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-xs text-gray-500">{l}</div><div className={`text-lg font-bold ${c || 'text-gray-900'}`}>{v}</div></div>
          ))}
        </div>
      )}
      {res && (
        <div className="text-xs text-gray-500 flex items-center gap-1"><Info className="w-3 h-3" />
          {res.trafficLive ? 'ETA calculées avec un fournisseur de trafic externe.' : `${res.etaNote} : modèle horaire (distance ÷ vitesse moyenne), pas de trafic temps réel.`}
          {' '}Positions des {res.positionWindowMin} dernières minutes · mise à jour toutes les 15 s.
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          <FleetMap vehicles={res?.vehicles ?? []} stops={selTour?.stops ?? []} hubs={mapHubs} selectedTourId={sel} onSelect={setSel} />
          {res && !res.vehicles.length && <div className="text-sm text-gray-500">Aucune position reçue récemment. Les positions arrivent quand les livreurs ouvrent l&apos;application avec la géolocalisation activée.</div>}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2 max-h-[540px] overflow-y-auto">
          <h2 className="font-semibold text-gray-800 flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-amber-600" />Alertes{res ? ` (${res.alertsTotal})` : ''}</h2>
          {res?.alerts.map(a => (
            <button key={a.id} onClick={() => { const t = res.tours.find(x => x.driverCode === a.driverCode && x.status !== 'DONE'); if (t) setSel(t.id) }} className={`w-full text-left rounded-lg border px-2 py-1.5 text-xs ${SEV[a.severity]}`}>
              <span className="font-semibold">{KIND[a.kind] ?? a.kind}</span> — {a.message}
            </button>
          ))}
          {res && !res.alerts.length && <div className="text-sm text-green-700">Aucune alerte.</div>}
          {res && res.alertsTotal > res.alerts.length && <div className="text-xs text-gray-400">+ {res.alertsTotal - res.alerts.length} autres</div>}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-left"><tr><th className="p-2">Livreur</th><th className="p-2">Tournée</th><th className="p-2">Statut</th><th className="p-2 w-48">Avancement</th><th className="p-2">Prochaine ETA</th><th className="p-2">Fin estimée</th><th className="p-2 text-right">Retard</th><th className="p-2 text-right">Risque</th></tr></thead>
          <tbody>
            {res?.tours.map(t => (
              <tr key={t.id} onClick={() => setSel(t.id === sel ? null : t.id)} className={`border-t border-gray-100 cursor-pointer hover:bg-purple-50 ${t.id === sel ? 'bg-purple-50' : ''}`}>
                <td className="p-2"><span className="inline-flex items-center gap-1"><Truck className="w-3 h-3 text-gray-400" /><b>{t.driverCode}</b> {t.driverName}</span></td>
                <td className="p-2">#{t.rotation}{t.hubCode ? ` · ${t.hubCode}` : ''}</td>
                <td className="p-2">{STATUS[t.status] ?? t.status}</td>
                <td className="p-2"><div className="flex items-center gap-2"><div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden"><div className={`h-full ${t.lateStops ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${t.progressPct}%` }} /></div><span className="text-xs text-gray-500 w-12 text-right">{t.done}/{t.total}</span></div></td>
                <td className="p-2">{hhmm(t.nextEtaAt)}</td><td className="p-2">{hhmm(t.lastEtaAt)}</td>
                <td className={`p-2 text-right ${t.lateStops ? 'text-red-700 font-semibold' : 'text-gray-400'}`}>{t.lateStops}</td>
                <td className={`p-2 text-right ${t.etaLateStops ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>{t.etaLateStops}</td>
              </tr>
            ))}
            {res && !res.tours.length && <tr><td colSpan={8} className="p-6 text-center text-gray-400">Aucune tournée pour ce jour. Construisez-les depuis « Tournées ».</td></tr>}
          </tbody>
        </table>
      </div>
      {selTour && (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <h2 className="font-semibold text-gray-800 mb-2">{selTour.driverName} — tournée {selTour.rotation}</h2>
          <ol className="text-sm space-y-1">
            {selTour.stops.map(s => (
              <li key={s.orderId} className="flex flex-wrap items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-gray-100 text-xs flex items-center justify-center font-bold">{s.seq}</span>
                <span className="font-mono">{s.ref}</span><span className="text-gray-500">{s.district ?? ''}</span>
                <span className="text-gray-700">{s.status}</span><span>ETA {hhmm(s.etaAt)}</span>
                {s.postponedCount > 0 && <span className="text-xs text-amber-700">reportée ×{s.postponedCount}</span>}
                {s.late && <span className="text-xs text-red-700 font-semibold">retard {s.lateMin} min</span>}
                {!s.late && s.etaLateMin > 0 && <span className="text-xs text-amber-700">dépasse le créneau de {s.etaLateMin} min</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
