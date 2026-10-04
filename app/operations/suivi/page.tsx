'use client'
import { useState, useEffect, useCallback } from 'react'
import { ListChecks, RefreshCw, Search, X, AlertTriangle, LifeBuoy } from 'lucide-react'
import OpsNav from '../components/OpsNav'

interface Row { id: string; ref: string; hubCode: string | null; district: string | null; status: string; slotLabel: string | null; amount: number | null; customer: string | null; driver: { code: string; name: string } | null; late: boolean; lateMin: number; deliveredLate: boolean; atRisk: boolean }
interface Res { day: string; counts: Record<string, number>; late: number; orders: Row[] }
interface Detail { id: string; ref: string; externalId: string; status: string; slotLabel: string | null; customer: string | null; address: string | null; amount: number | null; attempts: number; driver: { code: string; name: string; phone: string | null; hub: string | null } | null; events: { from: string | null; to: string; at: string; source: string }[]; tickets: { id: string; reference: string; subject: string; status: string }[] }

const STATUSES = [['READY_PICKUP', 'À dispatcher', '#3b82f6'], ['ASSIGNED', 'Assignée', '#8b5cf6'], ['IN_TRANSPORT', 'En transport', '#06b6d4'], ['START_DELIVERY', 'En livraison', '#f59e0b'], ['DELIVERED', 'Livrée', '#16a34a'], ['NO_SHOW', 'NO_SHOW', '#6b7280']] as const
const LBL = Object.fromEntries(STATUSES.map(s => [s[0], s[1]]))
const COL = Object.fromEntries(STATUSES.map(s => [s[0], s[2]]))
const fmt = (d: string) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' })

export default function SuiviPage() {
  const [day, setDay] = useState('today')
  const [status, setStatus] = useState('')
  const [lateOnly, setLateOnly] = useState(false)
  const [hub, setHub] = useState('')
  const [q, setQ] = useState('')
  const [hubs, setHubs] = useState<{ code: string; name: string }[]>([])
  const [res, setRes] = useState<Res | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [flash, setFlash] = useState('')

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ day }); if (status) qs.set('status', status); if (lateOnly) qs.set('late', '1'); if (hub) qs.set('hub', hub); if (q) qs.set('q', q)
    const r = await fetch(`/api/ops/orders?${qs}`); if (r.ok) setRes(await r.json())
  }, [day, status, lateOnly, hub, q])
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])
  useEffect(() => { const id = setInterval(load, 30_000); return () => clearInterval(id) }, [load])
  useEffect(() => { fetch('/api/ops/hubs').then(r => r.ok ? r.json() : null).then(j => j && setHubs(j.hubs)).catch(() => {}) }, [])

  const open = async (id: string) => { const r = await fetch(`/api/ops/orders/${id}`); if (r.ok) setDetail(await r.json()) }
  const claim = async (d: Detail) => {
    const r = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'retard', priority: 'haute', subject: `Commande ${d.ref} — ${LBL[d.status]}`, description: `Réclamation créée depuis le suivi. Créneau ${d.slotLabel ?? ''}, client ${d.customer ?? ''}, livreur ${d.driver?.name ?? 'non affecté'}.`, clientName: d.customer ?? undefined, orderRef: d.externalId }) })
    setFlash(r.ok ? 'Réclamation créée — visible dans Support Client' : 'Échec de création'); if (r.ok) open(d.id)
  }

  const total = res ? Object.values(res.counts).reduce((s, n) => s + n, 0) : 0
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><ListChecks className="w-5 h-5 text-purple-600" />Suivi des commandes</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-300 overflow-hidden bg-white text-sm">{[['yesterday', 'Hier'], ['today', "Aujourd'hui"], ['tomorrow', 'Demain']].map(([v, l]) => <button key={v} onClick={() => setDay(v)} className={`px-3 py-1.5 ${day === v ? 'bg-purple-600 text-white' : 'hover:bg-gray-50'}`}>{l}</button>)}</div>
          <button onClick={load} className="p-2 border border-gray-300 rounded-lg bg-white"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>
      <OpsNav />

      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setStatus(''); setLateOnly(false) }} className={`px-3 py-1.5 rounded-full text-sm border ${!status && !lateOnly ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'}`}>Toutes {total}</button>
        {STATUSES.map(([k, l, c]) => (
          <button key={k} onClick={() => { setStatus(status === k ? '' : k); setLateOnly(false) }} className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 ${status === k ? 'text-white' : 'bg-white border-gray-300'}`} style={status === k ? { background: c, borderColor: c } : {}}>
            <span className="w-2 h-2 rounded-full" style={{ background: c }} />{l} {res?.counts[k] ?? 0}
          </button>
        ))}
        <button onClick={() => { setLateOnly(!lateOnly); setStatus('') }} className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 ${lateOnly ? 'bg-red-600 text-white border-red-600' : 'bg-white border-red-300 text-red-700'}`}><AlertTriangle className="w-3.5 h-3.5" />En retard {res?.late ?? 0}</button>
        <select value={hub} onChange={e => setHub(e.target.value)} className="border border-gray-300 rounded-lg px-2 text-sm bg-white"><option value="">Tous les hubs</option>{hubs.map(h => <option key={h.code} value={h.code}>{h.name.replace('Marjane ', '')}</option>)}</select>
        <div className="relative"><Search className="w-4 h-4 absolute left-2.5 top-2 text-gray-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Réf, client, quartier…" className="border border-gray-300 rounded-lg pl-8 pr-2 py-1.5 text-sm w-52" /></div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200"><th className="p-2 pl-3 font-medium">Réf</th><th className="p-2 font-medium">Hub</th><th className="p-2 font-medium">Créneau</th><th className="p-2 font-medium">Statut</th><th className="p-2 font-medium">Livreur</th><th className="p-2 font-medium">Quartier</th><th className="p-2 font-medium">Retard</th><th className="p-2 font-medium text-right pr-3">Montant</th></tr></thead>
          <tbody>
            {res?.orders.map(o => (
              <tr key={o.id} onClick={() => open(o.id)} className={`border-t border-gray-100 cursor-pointer hover:brightness-95 ${o.late ? 'bg-red-50' : o.deliveredLate ? 'bg-orange-50' : o.atRisk ? 'bg-amber-50' : ''}`}>
                <td className="p-2 pl-3 font-mono text-xs">{o.ref}</td><td className="p-2 text-gray-500">{o.hubCode}</td><td className="p-2">{o.slotLabel?.replace('-', 'h–')}h</td>
                <td className="p-2"><span className="inline-flex items-center gap-1.5 text-xs"><span className="w-2 h-2 rounded-full" style={{ background: COL[o.status] }} />{LBL[o.status]}</span></td>
                <td className="p-2 text-gray-600">{o.driver ? o.driver.name : <span className="text-amber-600">—</span>}</td><td className="p-2 text-gray-500">{o.district}</td>
                <td className="p-2">{o.late ? <span className="text-red-600 font-semibold">+{o.lateMin} min</span> : o.deliveredLate ? <span className="text-orange-600">livrée +{o.lateMin} min</span> : o.atRisk ? <span className="text-amber-600">à risque</span> : <span className="text-gray-300">—</span>}</td>
                <td className="p-2 pr-3 text-right text-gray-500">{o.amount ? `${Math.round(o.amount)} MAD` : ''}</td>
              </tr>
            ))}
            {res && !res.orders.length && <tr><td colSpan={8} className="p-8 text-center text-gray-400">Aucune commande</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-gray-400">Rouge = en retard (créneau dépassé, non livrée) · orange = livrée hors créneau · ambre = fin de créneau dans moins de 45 min</div>

      {detail && (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="bg-white w-full max-w-md h-full p-5 overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start"><div><div className="text-lg font-bold">{detail.ref}</div><div className="text-sm text-gray-500">{LBL[detail.status]} · créneau {detail.slotLabel}</div></div><button onClick={() => setDetail(null)}><X className="w-5 h-5" /></button></div>
            <div className="mt-4 space-y-1 text-sm text-gray-700"><div><b>Client :</b> {detail.customer ?? '—'}</div><div><b>Adresse :</b> {detail.address ?? '—'}</div><div><b>Montant :</b> {detail.amount ? `${detail.amount} MAD` : '—'} · tentatives : {detail.attempts}</div><div><b>Livreur :</b> {detail.driver ? `${detail.driver.name} (${detail.driver.code}) — ${detail.driver.hub ?? ''}` : 'non affecté'}</div></div>
            <div className="mt-5 text-sm font-medium text-gray-800">Chronologie</div>
            <ol className="mt-2 border-l-2 border-gray-200 ml-1 space-y-3">
              {detail.events.map((e, i) => <li key={i} className="pl-4 relative"><span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full" style={{ background: COL[e.to] ?? '#999' }} /><div className="text-sm">{LBL[e.to] ?? e.to}</div><div className="text-xs text-gray-400">{fmt(e.at)} · {e.source}</div></li>)}
              {!detail.events.length && <li className="pl-4 text-xs text-gray-400">Aucun événement</li>}
            </ol>
            <div className="mt-5 text-sm font-medium text-gray-800">Réclamations</div>
            {detail.tickets.map(t => <div key={t.id} className="text-sm mt-1 text-gray-600">{t.reference} — {t.subject} <span className="text-xs text-gray-400">({t.status})</span></div>)}
            {!detail.tickets.length && <div className="text-xs text-gray-400 mt-1">Aucune</div>}
            <button onClick={() => claim(detail)} className="mt-3 flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50"><LifeBuoy className="w-4 h-4" />Créer une réclamation</button>
            {flash && <div className="text-xs text-green-700 mt-2">{flash}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
