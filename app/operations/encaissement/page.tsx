'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Banknote, RefreshCw, CheckCircle2, Clock, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import OpsNav from '../components/OpsNav'

interface Row { id: string; ref: string; hubCode: string | null; slot: string | null; district: string | null; customer: string | null; amount: number; deliveredAt: string | null; ageHours: number; driverCode: string; driverName: string }
interface Group { code: string; name: string; count: number; total: number; oldest: number }
interface Res { canCollect: boolean; totals: { count: number; total: number; over24h: number; over48h: number; collectedToday: number; collectedTodayAmount: number }; byDriver: Group[]; orders: Row[]
  recent: { id: string; ref: string; hubCode: string | null; amount: number | null; at: string; by: string | null; method: string | null; driver: string | null }[] }

const mad = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} MAD`
const age = (h: number) => (h < 1 ? '< 1 h' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} j`)
const ageCls = (h: number) => (h > 48 ? 'bg-red-100 text-red-700' : h > 24 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600')
const dt = (d: string | null) => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

// Encaissement : commandes LIVRÉES dont le montant (paiement à la livraison) n'a pas encore été remis.
// Une fois encaissée, la commande quitte cette liste et rejoint l'Historique : son parcours est terminé.
export default function EncaissementPage() {
  const [res, setRes] = useState<Res | null>(null)
  const [hub, setHub] = useState('')
  const [hubs, setHubs] = useState<{ code: string; name: string }[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [method, setMethod] = useState('especes')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => { const r = await fetch(`/api/ops/cash${hub ? `?hub=${hub}` : ''}`); if (r.ok) setRes(await r.json()) }, [hub])
  useEffect(() => { load() }, [load])
  useEffect(() => { fetch('/api/ops/hubs').then(r => r.ok ? r.json() : null).then(j => j && setHubs(j.hubs)).catch(() => {}) }, [])
  useEffect(() => { const id = setInterval(load, 30_000); return () => clearInterval(id) }, [load])

  const byDriver = useMemo(() => { const m = new Map<string, Row[]>(); for (const o of res?.orders ?? []) (m.get(o.driverCode) ?? m.set(o.driverCode, []).get(o.driverCode)!).push(o); return m }, [res])
  const selTotal = useMemo(() => (res?.orders ?? []).filter(o => sel.has(o.id)).reduce((s, o) => s + o.amount, 0), [res, sel])
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleGroup = (code: string, on: boolean) => setSel(s => { const n = new Set(s); (byDriver.get(code) ?? []).forEach(o => on ? n.add(o.id) : n.delete(o.id)); return n })

  const collect = async () => {
    setBusy(true); setMsg('')
    const r = await fetch('/api/ops/cash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'collect', orderIds: [...sel], method, note }) })
    const j = await r.json(); setBusy(false)
    if (r.ok) { setMsg(`${j.collected} commande(s) encaissée(s) — ${mad(j.total)}. Elles sont maintenant dans l'Historique.`); setSel(new Set()); setNote(''); load() } else setMsg(j.error || 'Erreur')
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Banknote className="w-5 h-5 text-green-600" />Encaissement</h1>
        <div className="flex items-center gap-2">
          <select value={hub} onChange={e => { setHub(e.target.value); setSel(new Set()) }} className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white"><option value="">Tous les hubs</option>{hubs.map(h => <option key={h.code} value={h.code}>{h.name.replace('Marjane ', '')}</option>)}</select>
          <button onClick={load} className="p-2 border border-gray-300 rounded-lg bg-white"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>
      <OpsNav />
      <p className="text-sm text-gray-500">Commandes <b>livrées</b> dont le montant n&apos;a pas encore été encaissé. Une fois encaissée, la commande disparaît d&apos;ici et rejoint l&apos;<b>Historique</b> : son parcours est terminé.</p>

      {res && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[['À encaisser', mad(res.totals.total), 'text-gray-900'], ['Commandes en attente', res.totals.count, 'text-gray-900'], ['En attente > 24 h', res.totals.over24h, res.totals.over24h ? 'text-amber-600' : 'text-green-600'], ['En attente > 48 h', res.totals.over48h, res.totals.over48h ? 'text-red-600' : 'text-green-600'], ['Encaissé aujourd’hui', mad(res.totals.collectedTodayAmount), 'text-green-600']].map(([l, v, c]) => (
            <div key={l as string} className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">{l}</div><div className={`text-xl font-bold ${c}`}>{v}</div></div>
          ))}
        </div>
      )}
      {msg && <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded-lg p-3">{msg}</div>}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          {res?.byDriver.map(g => {
            const rows = byDriver.get(g.code) ?? []; const isOpen = open.has(g.code); const allSel = rows.length > 0 && rows.every(o => sel.has(o.id))
            return (
              <div key={g.code} className="bg-white border border-gray-200 rounded-xl">
                <div className="flex items-center gap-3 p-3">
                  <input type="checkbox" checked={allSel} onChange={e => toggleGroup(g.code, e.target.checked)} disabled={!res.canCollect} />
                  <button onClick={() => setOpen(s => { const n = new Set(s); n.has(g.code) ? n.delete(g.code) : n.add(g.code); return n })} className="flex-1 flex items-center gap-2 text-left">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <span className="font-medium text-gray-900">{g.name} <span className="text-xs text-gray-400">{g.code}</span></span>
                  </button>
                  <span className="text-xs text-gray-500">{g.count} commande(s)</span><span className="font-semibold text-gray-900 w-28 text-right">{mad(g.total)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${ageCls(g.oldest)}`}><Clock className="w-3 h-3" />{age(g.oldest)}</span>
                </div>
                {isOpen && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {rows.map(o => (
                      <label key={o.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                        <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} disabled={!res.canCollect} />
                        <span className="font-mono text-xs text-gray-500 w-24">{o.ref}</span><span className="text-gray-500 w-14">{o.hubCode}</span><span className="text-gray-500 w-14">{o.slot?.replace('-', 'h–')}h</span>
                        <span className="flex-1 truncate text-gray-600">{o.customer ?? ''} {o.district ? `· ${o.district}` : ''}</span>
                        <span className={`text-[11px] px-1.5 rounded ${ageCls(o.ageHours)}`}>{age(o.ageHours)}</span><span className="w-24 text-right font-medium">{mad(o.amount)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {res && !res.byDriver.length && <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400"><CheckCircle2 className="w-8 h-8 mx-auto text-green-500 mb-2" />Tout est encaissé</div>}
        </div>

        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 sticky top-2">
            <div className="text-sm font-semibold text-gray-800">Encaisser la sélection</div>
            <div className="text-2xl font-bold text-gray-900">{mad(selTotal)} <span className="text-sm font-normal text-gray-400">· {sel.size} commande(s)</span></div>
            <label className="text-xs text-gray-600 block">Mode de remise<select value={method} onChange={e => setMethod(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"><option value="especes">Espèces</option><option value="carte">Carte bancaire</option><option value="virement">Virement</option></select></label>
            <label className="text-xs text-gray-600 block">Note (optionnel)<input value={note} onChange={e => setNote(e.target.value)} placeholder="ex. remise au responsable hub" className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
            <button onClick={collect} disabled={busy || !sel.size || !res?.canCollect} className="w-full py-2 text-sm rounded-lg bg-green-600 text-white disabled:opacity-40">Marquer comme encaissé</button>
            {!res?.canCollect && <div className="text-xs text-gray-400 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Rôle dispatcher ou supérieur requis</div>}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl">
            <div className="p-3 text-sm font-medium text-gray-700 border-b border-gray-100">Derniers encaissements</div>
            <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {res?.recent.map(r => <div key={r.id} className="px-3 py-2 text-xs flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" /><span className="font-mono text-gray-500">{r.ref}</span><span className="flex-1 truncate text-gray-500">{r.driver}</span><span className="font-medium">{mad(r.amount ?? 0)}</span><span className="text-gray-400">{dt(r.at)}</span></div>)}
              {res && !res.recent.length && <div className="p-3 text-xs text-gray-400">Aucun encaissement</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
