'use client'
import { useState, useEffect, useCallback } from 'react'
import { ScrollText, Download, Search } from 'lucide-react'

interface Row { id: string; at: string; actor: string | null; action: string; entity: string; entityId: string | null; hubCode: string | null; payload: string | null }
interface Res { total: number; offset: number; limit: number; modules: { key: string; count: number }[]; rows: Row[] }

const LABEL: Record<string, string> = { dispatch: 'Dispatch', attendance: 'Pointage', pay: 'Paie', fleet: 'Flotte', rh: 'RH', settings: 'Paramètres', notif: 'Notifications', cash: 'Encaissement', driver: 'Personnel', config: 'Configuration' }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const dt = (d: string) => new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

// Administration → Journal des actions : qui a fait quoi, quand (dispatch, pointage, paie, flotte, RH, encaissement, paramètres).
export default function JournalPage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000))); const [to, setTo] = useState(iso(new Date()))
  const [mod, setMod] = useState(''); const [q, setQ] = useState(''); const [actor, setActor] = useState('')
  const [res, setRes] = useState<Res | null>(null)
  const [page, setPage] = useState(0)
  const [err, setErr] = useState('')

  const qs = useCallback((extra = '') => `from=${from}&to=${to}${mod ? `&module=${mod}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${actor ? `&actor=${encodeURIComponent(actor)}` : ''}${extra}`, [from, to, mod, q, actor])
  useEffect(() => { setPage(0) }, [from, to, mod, q, actor])
  useEffect(() => {
    const t = setTimeout(async () => { const r = await fetch(`/api/ops/audit?${qs(`&limit=100&offset=${page * 100}`)}`); const j = await r.json(); if (r.ok) { setRes(j); setErr('') } else setErr(j.error || 'Accès réservé à l’administration') }, q || actor ? 300 : 0)
    return () => clearTimeout(t)
  }, [qs, page, q, actor])

  const pretty = (p: string | null) => { if (!p) return ''; try { return Object.entries(JSON.parse(p)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') } catch { return p } }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><ScrollText className="w-5 h-5 text-slate-700" />Journal des actions</h1>
          <p className="text-sm text-gray-500">Traçabilité : dispatch, pointage, paie, flotte, RH, encaissement et paramétrage — qui a fait quoi, et quand.</p></div>
        <a href={`/api/ops/audit?${qs('&format=csv')}`} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-slate-800 text-white"><Download className="w-4 h-4" />Export CSV</a>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500">Au<input type="date" value={to} onChange={e => setTo(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500">Acteur<input value={actor} onChange={e => setActor(e.target.value)} placeholder="nom ou e-mail" className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-44" /></label>
        <label className="text-xs text-gray-500 relative">Recherche libre<Search className="w-4 h-4 absolute left-2.5 bottom-2 text-gray-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="objet, code, détail…" className="block border border-gray-300 rounded-lg pl-8 pr-2 py-1.5 text-sm w-56" /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setMod('')} className={`px-3 py-1 rounded-full text-sm border ${!mod ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-gray-300'}`}>Tout</button>
        {res?.modules.map(m => <button key={m.key} onClick={() => setMod(mod === m.key ? '' : m.key)} className={`px-3 py-1 rounded-full text-sm border ${mod === m.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-gray-300'}`}>{LABEL[m.key] ?? m.key} <span className="opacity-60">{m.count}</span></button>)}
      </div>

      {err && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">{err}</div>}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200">{['Date', 'Acteur', 'Action', 'Objet', 'Hub', 'Détail'].map(h => <th key={h} className="p-2 font-medium first:pl-3">{h}</th>)}</tr></thead>
          <tbody>
            {res?.rows.map(r => (
              <tr key={r.id} className="border-t border-gray-100 align-top">
                <td className="p-2 pl-3 whitespace-nowrap text-gray-500 text-xs">{dt(r.at)}</td><td className="p-2">{r.actor ?? '—'}</td>
                <td className="p-2"><span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{r.action}</span></td>
                <td className="p-2 text-gray-600 text-xs">{r.entity} {r.entityId ? <span className="font-mono text-gray-400">{r.entityId.length > 12 ? r.entityId.slice(0, 10) + '…' : r.entityId}</span> : ''}</td><td className="p-2 text-gray-500 text-xs">{r.hubCode ?? ''}</td>
                <td className="p-2 text-xs text-gray-500 max-w-md break-words">{pretty(r.payload)}</td>
              </tr>
            ))}
            {res && !res.rows.length && <tr><td colSpan={6} className="p-8 text-center text-gray-400">Aucune action sur ces critères</td></tr>}
          </tbody>
        </table>
      </div>
      {res && res.total > 100 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{res.offset + 1}–{Math.min(res.offset + 100, res.total)} sur {res.total}</span>
          <div className="flex gap-2"><button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-gray-300 rounded-lg bg-white disabled:opacity-40">Précédent</button><button disabled={(page + 1) * 100 >= res.total} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-gray-300 rounded-lg bg-white disabled:opacity-40">Suivant</button></div>
        </div>
      )}
    </div>
  )
}
