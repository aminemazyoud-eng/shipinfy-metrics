'use client'
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertTriangle, Timer, CheckCircle2, Info } from 'lucide-react'
import ExpressPicking from '../../picking/ExpressPicking'
import { usePolling } from '@/lib/use-polling'

interface PO { id: string; ref: string; hubCode: string | null; sector: string | null; waveId: string | null; slot: string | null; prepStatus: string; receivedAt: string; readyAt: string | null; pickedAt: string | null; elapsedMin: number; slaRemainingMin: number; slaWarn: boolean; driver: string | null }
interface Res { day: string; kpis: { toPrep: number; ready: number; pickedUp: number; avgPrepMin: number }; ranking: { hubCode: string; handled: number; avgPrepMin: number; slaRate: number }[]; alerts: string[]; orders: PO[] }

const META: Record<string, { label: string; cls: string }> = {
  a_preparer: { label: 'À préparer', cls: 'bg-gray-100 text-gray-600' },
  prete: { label: 'Prête (assignée)', cls: 'bg-green-100 text-green-700' },
  recuperee: { label: 'Récupérée', cls: 'bg-blue-100 text-blue-700' },
}
const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' }) : '—')

// Préparation / picking en TEMPS RÉEL (ex /picking). Les anciens rapports Express importés restent consultables (mode « Import Express »).
export default function Preparation() {
  const [view, setView] = useState<'live' | 'express'>('live')
  const [day, setDay] = useState('today')
  const [hub, setHub] = useState('')
  const [hubs, setHubs] = useState<{ code: string; name: string }[]>([])
  const [res, setRes] = useState<Res | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    const r = await fetch(`/api/ops/preparation?day=${day}${hub ? `&hub=${hub}` : ''}`); if (r.ok) setRes(await r.json())
  }, [day, hub])
  useEffect(() => { load() }, [load])
  usePolling(load, 30_000)
  useEffect(() => { fetch('/api/ops/hubs').then(r => r.ok ? r.json() : null).then(j => j && setHubs(j.hubs)).catch(() => {}) }, [])

  const k = res?.kpis ?? { toPrep: 0, ready: 0, pickedUp: 0, avgPrepMin: 0 }
  const list = (res?.orders ?? []).filter(o => !filter || o.prepStatus === filter)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {([['live', 'Préparation en direct'], ['express', 'Import Express (rapports)']] as const).map(([v, l]) => <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-full text-sm border ${view === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'}`}>{l}</button>)}
      </div>

      {view === 'express' ? <div className="-mx-3 md:-mx-4 lg:-mx-6"><ExpressPicking /></div> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select value={day} onChange={e => setDay(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"><option value="yesterday">Hier</option><option value="today">Aujourd&apos;hui</option><option value="tomorrow">Demain</option></select>
            <select value={hub} onChange={e => setHub(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"><option value="">Tous les hubs</option>{hubs.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}</select>
            <button onClick={load} className="p-2 border border-gray-300 rounded-lg bg-white" aria-label="Rafraîchir"><RefreshCw className="w-4 h-4" /></button>
          </div>
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800"><Info size={16} className="shrink-0 mt-0.5" /><span>Statuts dérivés des commandes en temps réel : <b>À préparer</b> = reçue, pas encore dispatchée · <b>Prête</b> = assignée à un livreur · <b>Récupérée</b> = prise en charge. L&apos;échéance de préparation est le début du créneau. Les lots à préparer sont dans l&apos;onglet « Lots (vagues) ».</span></div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[{ l: 'À préparer', v: k.toPrep, c: 'text-gray-700', bg: 'bg-gray-50', f: 'a_preparer' }, { l: 'Prêtes (assignées)', v: k.ready, c: 'text-green-700', bg: 'bg-green-50', f: 'prete' }, { l: 'Récupérées', v: k.pickedUp, c: 'text-blue-700', bg: 'bg-blue-50', f: 'recuperee' }, { l: 'Délai moyen reçue → assignée', v: `${k.avgPrepMin} min`, c: 'text-orange-700', bg: 'bg-orange-50', f: '' }].map(c => (
              <button key={c.l} onClick={() => c.f && setFilter(filter === c.f ? '' : c.f)} className={`${c.bg} text-left rounded-xl border p-3 ${filter && filter === c.f ? 'border-gray-900' : 'border-gray-200'}`}><div className={`text-2xl font-bold ${c.c}`}>{c.v}</div><div className="text-xs text-gray-500 mt-0.5">{c.l}</div></button>
            ))}
          </div>

          {res && res.alerts.length > 0 && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3"><div className="flex items-center gap-2 text-sm font-semibold text-red-700"><AlertTriangle size={15} />{res.alerts.length} commande(s) à préparer dont le créneau démarre dans moins de 30 min (ou déjà commencé)</div><div className="mt-1 text-xs text-red-600">{res.alerts.join(', ')}</div></div>}

          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr>{['Réf', 'Hub', 'Secteur', 'Lot', 'Créneau', 'Statut', 'Reçue', 'Prête', 'Récupérée', 'Écoulé', 'Avant le créneau', 'Livreur'].map(h => <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {list.map(o => {
                  const m = META[o.prepStatus]
                  return (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-mono text-xs">{o.ref}</td><td className="px-3 py-2.5 text-gray-500">{o.hubCode}</td><td className="px-3 py-2.5 text-gray-500">{o.sector ?? '—'}</td><td className="px-3 py-2.5 text-gray-500">{o.waveId ? o.waveId.slice(-6) : '—'}</td><td className="px-3 py-2.5">{o.slot?.replace('-', 'h–')}h</td>
                      <td className="px-3 py-2.5"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span></td>
                      <td className="px-3 py-2.5 text-gray-600">{hhmm(o.receivedAt)}</td><td className="px-3 py-2.5 text-gray-600">{hhmm(o.readyAt)}</td><td className="px-3 py-2.5 text-gray-600">{hhmm(o.pickedAt)}</td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap"><Timer size={12} className="inline text-gray-400 mr-1" />{o.elapsedMin} min</td>
                      <td className="px-3 py-2.5">{o.prepStatus !== 'a_preparer' ? <CheckCircle2 size={14} className="text-green-600" /> : o.slaWarn ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700"><AlertTriangle size={11} />{o.slaRemainingMin} min</span> : <span className="text-xs text-gray-600">{o.slaRemainingMin} min</span>}</td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{o.driver ?? '—'}</td>
                    </tr>
                  )
                })}
                {res && !list.length && <tr><td colSpan={12} className="p-8 text-center text-gray-400">Aucune commande à suivre</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2"><CheckCircle2 size={15} className="text-blue-600" /><span className="text-sm font-semibold text-gray-800">Classement des hubs (préparation)</span></div>
            <table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Hub', 'Commandes préparées', 'Délai moyen', 'Prêtes avant le créneau'].map(h => <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {!res || !res.ranking.length ? <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">Aucune donnée</td></tr> : res.ranking.map(p => (
                  <tr key={p.hubCode}><td className="px-3 py-3 font-medium text-gray-900">{p.hubCode}</td><td className="px-3 py-3 text-gray-600">{p.handled}</td><td className="px-3 py-3 text-gray-600">{p.avgPrepMin} min</td>
                    <td className="px-3 py-3"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.slaRate >= 80 ? 'bg-green-100 text-green-700' : p.slaRate >= 50 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-600'}`}>{p.slaRate}%</span></td></tr>
                ))}
              </tbody></table>
          </div>
        </>
      )}
    </div>
  )
}
