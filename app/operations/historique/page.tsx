'use client'
import { useState, useEffect, useCallback } from 'react'
import { History, Download, Search, CheckCircle2, X } from 'lucide-react'
import OpsNav from '../components/OpsNav'

interface Row { id: string; ref: string; hubCode: string | null; slot: string | null; district: string | null; customer: string | null; driver: string | null; amount: number; deliveredAt: string | null; collectedAt: string | null; collectedBy: string | null; method: string | null; onTime: boolean | null }
interface Res { total: number; amount: number; offset: number; rows: Row[] }

const PAGE = 100
const mad = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} MAD`
const iso = (d: Date) => d.toISOString().slice(0, 10)
const dt = (d: string | null) => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const METHOD: Record<string, string> = { especes: 'Espèces', carte: 'Carte', virement: 'Virement' }

// Opérations → Historique : commandes TERMINÉES (livrées ET encaissées) — fin de parcours.
// Recherche par code, livreur, hub et date. (Les analyses de volumes/ponctualité sont dans Performance → Analyse.)
export default function HistoriquePage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000))); const [to, setTo] = useState(iso(new Date()))
  const [hub, setHub] = useState(''); const [driver, setDriver] = useState(''); const [q, setQ] = useState('')
  const [hubs, setHubs] = useState<{ code: string; name: string }[]>([])
  const [drivers, setDrivers] = useState<{ code: string; firstName: string; lastName: string }[]>([])
  const [res, setRes] = useState<Res | null>(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    fetch('/api/ops/hubs').then(r => r.ok ? r.json() : null).then(j => j && setHubs(j.hubs)).catch(() => {})
    fetch('/api/rh/people?type=chauffeur').then(r => r.ok ? r.json() : null).then(j => j && setDrivers(j.people)).catch(() => {})
  }, [])
  const qs = useCallback((extra = '') => `view=done&from=${from}&to=${to}${hub ? `&hub=${hub}` : ''}${driver ? `&driver=${driver}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${extra}`, [from, to, hub, driver, q])
  useEffect(() => { setPage(0) }, [from, to, hub, driver, q])
  useEffect(() => {
    const t = setTimeout(async () => { const r = await fetch(`/api/ops/history?${qs(`&offset=${page * PAGE}`)}`); if (r.ok) setRes(await r.json()) }, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [qs, page, q])
  const reset = () => { setHub(''); setDriver(''); setQ(''); setFrom(iso(new Date(Date.now() - 30 * 86_400_000))); setTo(iso(new Date())) }
  const filtered = hub || driver || q

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><History className="w-5 h-5 text-purple-600" />Historique des commandes</h1>
      <OpsNav />
      <p className="text-sm text-gray-500">Commandes <b>terminées</b> : livrées et encaissées — leur parcours est fini. Les commandes livrées en attente d&apos;encaissement sont dans <b>Encaissement</b>.</p>

      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500 relative">Code / recherche<Search className="w-4 h-4 absolute left-2.5 bottom-2 text-gray-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="réf commande, client, quartier…" className="block border border-gray-300 rounded-lg pl-8 pr-2 py-1.5 text-sm w-60" /></label>
        <label className="text-xs text-gray-500">Livreur<select value={driver} onChange={e => setDriver(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white w-48"><option value="">Tous les livreurs</option>{drivers.map(d => <option key={d.code} value={d.code}>{d.firstName} {d.lastName} ({d.code})</option>)}</select></label>
        <label className="text-xs text-gray-500">Hub<select value={hub} onChange={e => setHub(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white w-44"><option value="">Tous les hubs</option>{hubs.map(h => <option key={h.code} value={h.code}>{h.name.replace('Marjane ', '')}</option>)}</select></label>
        <label className="text-xs text-gray-500">Encaissée du<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500">au<input type="date" value={to} onChange={e => setTo(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        {filtered && <button onClick={reset} className="flex items-center gap-1 text-xs px-2.5 py-2 border border-gray-300 rounded-lg"><X className="w-3.5 h-3.5" />Réinitialiser</button>}
        <a href={`/api/ops/history?${qs('&format=csv')}`} className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-purple-600 text-white"><Download className="w-4 h-4" />Export CSV</a>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">Commandes terminées</div><div className="text-xl font-bold text-gray-900">{res ? res.total.toLocaleString('fr-FR') : '…'}</div></div>
        <div className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">Montant encaissé</div><div className="text-xl font-bold text-green-600">{res ? mad(res.amount) : '…'}</div></div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200">{['Réf', 'Hub', 'Créneau', 'Livreur', 'Client', 'Livrée le', 'Encaissée le', 'Par', 'Mode', 'Montant'].map(h => <th key={h} className="p-2 font-medium whitespace-nowrap first:pl-3">{h}</th>)}</tr></thead>
          <tbody>
            {res?.rows.map(r => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="p-2 pl-3 font-mono text-xs whitespace-nowrap"><CheckCircle2 className="w-3.5 h-3.5 text-green-600 inline mr-1" />{r.ref}</td><td className="p-2 text-gray-500">{r.hubCode}</td><td className="p-2">{r.slot?.replace('-', 'h–')}h</td>
                <td className="p-2 text-gray-600">{r.driver ?? '—'}</td><td className="p-2 text-gray-600">{r.customer ?? ''}{r.district ? <span className="text-xs text-gray-400"> · {r.district}</span> : ''}</td>
                <td className="p-2 whitespace-nowrap">{dt(r.deliveredAt)} {r.onTime === false && <span className="text-[10px] px-1 rounded bg-orange-100 text-orange-700">hors créneau</span>}</td><td className="p-2 whitespace-nowrap">{dt(r.collectedAt)}</td>
                <td className="p-2 text-gray-500 text-xs">{r.collectedBy}</td><td className="p-2 text-gray-500 text-xs">{METHOD[r.method ?? ''] ?? r.method}</td><td className="p-2 text-right font-medium whitespace-nowrap">{mad(r.amount)}</td>
              </tr>
            ))}
            {res && !res.rows.length && <tr><td colSpan={10} className="p-8 text-center text-gray-400">Aucune commande terminée pour ces critères</td></tr>}
          </tbody>
        </table>
      </div>
      {res && res.total > PAGE && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{res.offset + 1}–{Math.min(res.offset + PAGE, res.total)} sur {res.total.toLocaleString('fr-FR')}</span>
          <div className="flex gap-2"><button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-gray-300 rounded-lg bg-white disabled:opacity-40">Précédent</button><button disabled={(page + 1) * PAGE >= res.total} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-gray-300 rounded-lg bg-white disabled:opacity-40">Suivant</button></div>
        </div>
      )}
    </div>
  )
}
