'use client'
import { useState, useEffect, useCallback } from 'react'
import { Route, RefreshCw, ArrowUp, ArrowDown, Wand2, Settings2, Info } from 'lucide-react'
import OpsNav from '../components/OpsNav'
import { usePolling } from '@/lib/use-polling'

interface Stop { orderId: string; ref: string; seq: number; status: string; etaAt: string | null; slotLabel: string | null; slotEnd: string; sector: string | null; district: string | null; customer: string | null; address: string | null; postponedCount: number; late: boolean; lateMin: number; etaLateMin: number }
interface Tour { id: string; driverCode: string; driverName: string; vehicleRef: string | null; hubCode: string | null; rotation: number; status: string; total: number; done: number; remaining: number; progressPct: number; nextEtaAt: string | null; lastEtaAt: string | null; lateStops: number; etaLateStops: number; stops: Stop[] }
interface Res { day: string; etaNote: string; trafficLive: boolean; unplanned: number; unassigned: number; tours: Tour[] }
interface Build { tours: unknown[]; created: number; updated: number; removedTours: number; lockedTours: number; skippedStarted: number; warnings: string[] }
interface Settings { [k: string]: number | number[] }

const STATUS: Record<string, [string, string]> = { PLANNED: ['Planifiée', 'bg-gray-100 text-gray-700'], LOADING: ['Chargement', 'bg-blue-100 text-blue-700'], ONGOING: ['En cours', 'bg-amber-100 text-amber-800'], DONE: ['Terminée', 'bg-green-100 text-green-700'] }
const ST_LBL: Record<string, string> = { ASSIGNED: 'Assignée', IN_TRANSPORT: 'Acceptée', START_DELIVERY: 'En livraison', DELIVERED: 'Livrée', NO_SHOW: 'Absent', CANCELLED: 'Annulée', READY_PICKUP: 'À dispatcher' }
const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' }) : '—')
const isClosed = (s: string) => s === 'DELIVERED' || s === 'NO_SHOW' || s === 'CANCELLED'
const PARAMS: [string, string, string][] = [
  ['serviceMin', 'Temps de service par stop (min)', ''], ['maxStops', 'Capacité : stops par rotation', ''], ['rotationsPerSlot', 'Rotations max par créneau', ''], ['loadMin', 'Chargement avant départ (min)', ''],
  ['maxPostpones', 'Reports max par commande', ''], ['etaDriftNotifyMin', 'Prévenir le client si l\'ETA dérive de (min)', ''], ['baseSpeedKmh', 'Vitesse moyenne hors trafic (km/h)', ''],
  ['roadFactor', 'Facteur de détour route / vol d\'oiseau', ''], ['trafficCoef', 'Coefficient de trafic global (>1 = plus lent)', ''], ['waveTarget', 'Vagues : taille cible d\'un lot', ''], ['waveMax', 'Vagues : taille max d\'un lot', ''], ['waveWidenMin', 'Vagues : fenêtre élargie (min)', ''],
]

export default function TourneesPage() {
  const [day, setDay] = useState('today')
  const [hub, setHub] = useState('')
  const [hubs, setHubs] = useState<{ code: string; name: string }[]>([])
  const [res, setRes] = useState<Res | null>(null)
  const [flash, setFlash] = useState('')
  const [warn, setWarn] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [showSet, setShowSet] = useState(false)
  const [set, setSet] = useState<Settings | null>(null)
  const [curve, setCurve] = useState('')

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ day }); if (hub) qs.set('hub', hub)
    const r = await fetch(`/api/ops/tours?${qs}`); if (r.ok) setRes(await r.json())
  }, [day, hub])
  useEffect(() => { load() }, [load])
  usePolling(load, 30_000)
  useEffect(() => { fetch('/api/ops/hubs').then(r => r.ok ? r.json() : null).then(j => j && setHubs(j.hubs)).catch(() => {}) }, [])
  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(''), 6000) }

  const build = async (reoptimize: boolean) => {
    if (reoptimize && !confirm('Recalculer tout l\'ordre des tournées non démarrées ? Les réordonnancements manuels seront remplacés.')) return
    setBusy(true)
    const r = await fetch('/api/ops/tours/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, hub: hub || undefined, reoptimize }) })
    const j: Build & { error?: string } = await r.json().catch(() => ({} as Build))
    setBusy(false)
    if (!r.ok) { say(j.error ?? 'Échec de la construction'); return }
    setWarn(j.warnings ?? [])
    say(`${j.created} tournée(s) créée(s), ${j.updated} mise(s) à jour, ${j.removedTours} supprimée(s)${j.lockedTours ? ` · ${j.lockedTours} déjà démarrée(s), non modifiée(s)` : ''}`)
    load()
  }
  const move = async (t: Tour, orderId: string, dir: -1 | 1) => {
    const ids = t.stops.filter(s => !isClosed(s.status)).map(s => s.orderId)
    const i = ids.indexOf(orderId), j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    const r = await fetch('/api/ops/tours', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tourId: t.id, orderIds: ids }) })
    if (!r.ok) say((await r.json().catch(() => ({}))).error ?? 'Réordonnancement refusé')
    load()
  }
  const openSettings = async () => {
    setShowSet(s => !s)
    if (!set) { const r = await fetch('/api/ops/tours/params'); if (r.ok) { const j = await r.json(); setSet(j.settings); setCurve((j.settings.trafficCurve as number[]).join(', ')) } }
  }
  const saveSettings = async () => {
    if (!set) return
    const body: Record<string, unknown> = { ...set }
    const c = curve.split(/[,\s;]+/).filter(Boolean).map(Number)
    if (c.length === 24) body.trafficCurve = c; else delete body.trafficCurve
    const r = await fetch('/api/ops/tours/params', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (r.ok) { setSet(j.settings); setCurve((j.settings.trafficCurve as number[]).join(', ')); say(c.length === 24 || !curve.trim() ? 'Réglages enregistrés' : 'Réglages enregistrés (la courbe doit contenir 24 valeurs : ignorée)') } else say(j.error ?? 'Accès refusé ou valeurs hors bornes')
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Route className="w-5 h-5 text-purple-600" />Tournées</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select value={day} onChange={e => setDay(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"><option value="today">Aujourd&apos;hui</option><option value="tomorrow">Demain</option><option value="-1">Hier</option></select>
          <select value={hub} onChange={e => setHub(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"><option value="">Tous les hubs</option>{hubs.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}</select>
          <button onClick={() => build(false)} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">Construire / compléter</button>
          <button onClick={() => build(true)} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50 disabled:opacity-50 flex items-center gap-1"><Wand2 className="w-4 h-4" />Réoptimiser</button>
          <button onClick={load} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={openSettings} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 flex items-center gap-1"><Settings2 className="w-4 h-4" />Réglages</button>
        </div>
      </div>
      <OpsNav />
      {flash && <div className="rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm px-3 py-2">{flash}</div>}
      {warn.length > 0 && <ul className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 list-disc list-inside">{warn.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {res && (
        <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1"><Info className="w-3 h-3" />{res.trafficLive ? 'ETA avec fournisseur de trafic externe.' : `${res.etaNote} (modèle horaire, sans trafic temps réel).`}</span>
          {res.unassigned > 0 && <span className="text-amber-700">{res.unassigned} commande(s) à affecter (Dispatch)</span>}
          {res.unplanned > 0 && <span className="text-amber-700">{res.unplanned} commande(s) affectée(s) sans tournée : « Construire / compléter »</span>}
        </div>
      )}

      {showSet && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h2 className="font-semibold text-gray-800">Réglages tournées, ETA et vagues</h2>
          {!set ? <div className="text-sm text-gray-400">Chargement…</div> : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {PARAMS.map(([k, label]) => (
                  <label key={k} className="text-xs text-gray-500">{label}
                    <input type="number" step="any" value={typeof set[k] === 'number' ? (set[k] as number) : ''} onChange={e => setSet({ ...set, [k]: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
                  </label>
                ))}
              </div>
              <label className="text-xs text-gray-500 block">Courbe de vitesse par heure locale (24 valeurs, 0h → 23h ; 1 = fluide, 0,6 = dense) — valeurs de départ à calibrer avec vos données
                <textarea value={curve} onChange={e => setCurve(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-mono text-gray-900" />
              </label>
              <button onClick={saveSettings} className="px-4 py-1.5 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700">Enregistrer</button>
            </>
          )}
        </div>
      )}

      {res?.tours.map(t => {
        const [lbl, cls] = STATUS[t.status] ?? [t.status, 'bg-gray-100 text-gray-700']
        const isOpen = open[t.id] ?? t.status !== 'DONE'
        const openIds = t.stops.filter(s => !isClosed(s.status))
        return (
          <div key={t.id} className="rounded-xl border border-gray-200 bg-white">
            <button onClick={() => setOpen({ ...open, [t.id]: !isOpen })} className="w-full flex flex-wrap items-center gap-3 p-3 text-left">
              <span className="font-bold text-gray-900">{t.driverCode} <span className="font-normal text-gray-600">{t.driverName}</span></span>
              <span className="text-sm text-gray-500">Rotation {t.rotation}{t.vehicleRef ? ` · ${t.vehicleRef}` : ''}{t.hubCode ? ` · ${t.hubCode}` : ''}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{lbl}</span>
              <div className="flex items-center gap-2 flex-1 min-w-[140px]"><div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden"><div className={`h-full ${t.lateStops ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${t.progressPct}%` }} /></div><span className="text-xs text-gray-500">{t.done}/{t.total}</span></div>
              <span className="text-xs text-gray-500">Prochaine ETA {hhmm(t.nextEtaAt)} · fin {hhmm(t.lastEtaAt)}</span>
              {t.lateStops > 0 && <span className="text-xs text-red-700 font-semibold">{t.lateStops} en retard</span>}
              {t.etaLateStops > 0 && <span className="text-xs text-amber-700 font-semibold">{t.etaLateStops} à risque</span>}
            </button>
            {isOpen && (
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-left text-xs"><tr><th className="p-2 w-10">#</th><th className="p-2">Réf.</th><th className="p-2">Client / adresse</th><th className="p-2">Secteur</th><th className="p-2">Créneau</th><th className="p-2">Statut</th><th className="p-2">ETA*</th><th className="p-2" /></tr></thead>
                  <tbody>
                    {t.stops.map(s => {
                      const closed = isClosed(s.status), idx = openIds.findIndex(x => x.orderId === s.orderId)
                      return (
                        <tr key={s.orderId} className={`border-t border-gray-50 ${closed ? 'opacity-60' : ''}`}>
                          <td className="p-2 font-bold">{s.seq}</td>
                          <td className="p-2 font-mono">{s.ref}{s.postponedCount > 0 && <span className="ml-1 text-[10px] text-amber-700">reportée ×{s.postponedCount}</span>}</td>
                          <td className="p-2"><div>{s.customer ?? '—'}</div><div className="text-xs text-gray-400 max-w-xs truncate">{s.address ?? s.district ?? ''}</div></td>
                          <td className="p-2 text-xs">{s.sector ?? '—'}</td><td className="p-2 text-xs">{s.slotLabel ?? '—'}</td>
                          <td className="p-2 text-xs">{ST_LBL[s.status] ?? s.status}{s.late && <span className="ml-1 text-red-700 font-semibold">+{s.lateMin} min</span>}</td>
                          <td className={`p-2 ${!s.late && s.etaLateMin > 0 ? 'text-amber-700 font-semibold' : ''}`}>{closed ? '—' : hhmm(s.etaAt)}{!closed && !s.late && s.etaLateMin > 0 && <span className="block text-[10px]">dépasse de {s.etaLateMin} min</span>}</td>
                          <td className="p-2 text-right whitespace-nowrap">
                            {!closed && t.status !== 'DONE' && <>
                              <button onClick={() => move(t, s.orderId, -1)} disabled={idx <= 0} aria-label="Monter" className="p-1 text-gray-400 hover:text-gray-800 disabled:opacity-20"><ArrowUp className="w-4 h-4" /></button>
                              <button onClick={() => move(t, s.orderId, 1)} disabled={idx < 0 || idx >= openIds.length - 1} aria-label="Descendre" className="p-1 text-gray-400 hover:text-gray-800 disabled:opacity-20"><ArrowDown className="w-4 h-4" /></button>
                            </>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
      {res && !res.tours.length && <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 text-sm">Aucune tournée. Affectez des commandes aux livreurs (Dispatch) puis cliquez « Construire / compléter ».</div>}
      <p className="text-[11px] text-gray-400">* ETA estimées sans trafic live : distance à vol d&apos;oiseau × facteur de détour ÷ vitesse moyenne selon l&apos;heure + temps de service. Une tournée démarrée n&apos;est jamais reconstruite.</p>
    </div>
  )
}
