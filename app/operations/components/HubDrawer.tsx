'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { X, Wand2, ExternalLink, AlertTriangle } from 'lucide-react'

interface Order { id: string; ref: string; status: string; slotLabel: string | null; district: string | null; driverCode: string | null; late: boolean; atRisk: boolean; amount: number | null }
interface Driver { code: string; name: string; hubCode: string | null; attendance: string | null; active: number; done: number; late: number }
interface Data { hubCode: string; hubs: { code: string; name: string; city: string }[]; orders: Order[]; drivers: Driver[] }

const DONE = ['DELIVERED', 'NO_SHOW']
const ATT: Record<string, string> = { present: 'Présent', late: 'En retard', absent: 'Absent', leave: 'Congé' }

// Cockpit → clic sur un hub : ce qui s'y passe + dispatch direct (sélection → livreur, ou auto-dispatch).
export default function HubDrawer({ hub, onClose, onChanged }: { hub: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; s: string } | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/ops/dispatch?hub=${hub}&day=today`)
    if (r.ok) setData(await r.json())
  }, [hub])
  useEffect(() => { setData(null); setSel(new Set()); load() }, [load])

  const drivers = useMemo(() => (data?.drivers ?? []).filter(d => d.hubCode === hub), [data, hub])
  const orders = data?.orders ?? []
  const pending = orders.filter(o => !o.driverCode && !DONE.includes(o.status))
  const bySlot = useMemo(() => {
    const m = new Map<string, Order[]>(); for (const o of pending) { const k = o.slotLabel || '—'; (m.get(k) ?? m.set(k, []).get(k)!).push(o) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [pending])
  const running = orders.filter(o => o.driverCode && !DONE.includes(o.status)).length
  const done = orders.filter(o => o.status === 'DELIVERED').length
  const late = orders.filter(o => o.late)
  const name = data?.hubs.find(h => h.code === hub)

  const run = async (url: string, body: unknown, ok: (j: Record<string, unknown>) => string) => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json()
      setMsg({ ok: r.ok, s: r.ok ? ok(j) : j.error || 'Erreur' })
      if (r.ok) { setSel(new Set()); await load(); onChanged() }
    } finally { setBusy(false) }
  }
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-lg h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-start justify-between z-10">
          <div><div className="text-lg font-bold text-gray-900">{name?.name ?? hub}</div><div className="text-xs text-gray-400">{name?.city} · {drivers.length} livreur(s) · aujourd&apos;hui</div></div>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          {!data && <div className="text-sm text-gray-400">Chargement…</div>}
          {data && (
            <>
              <div className="grid grid-cols-4 gap-2 text-center">
                {([['À dispatcher', pending.length, 'text-amber-600'], ['En cours', running, 'text-gray-900'], ['Livrées', done, 'text-green-600'], ['En retard', late.length, late.length ? 'text-red-600' : 'text-green-600']] as const).map(([l, v, c]) => (
                  <div key={l} className="border border-gray-200 rounded-lg p-2"><div className={`text-xl font-bold ${c}`}>{v}</div><div className="text-[10px] text-gray-500">{l}</div></div>
                ))}
              </div>
              {msg && <div className={`text-sm rounded-lg p-2.5 border ${msg.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.s}</div>}

              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-gray-800">Commandes à dispatcher ({pending.length})</div>
                  <button disabled={busy || !pending.length} onClick={() => run('/api/ops/dispatch/auto', { hub, day: 'today' }, j => `Auto-dispatch : ${j.assigned ?? 0} commande(s) réparties`)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-purple-600 text-white disabled:opacity-40"><Wand2 className="w-3.5 h-3.5" />Auto-dispatch</button>
                </div>
                {!pending.length && <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg p-4 text-center">Rien à dispatcher sur ce hub</div>}
                <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg">
                  {bySlot.map(([slot, list]) => (
                    <div key={slot}>
                      <label className="flex items-center gap-2 px-3 py-1 bg-gray-50 text-xs font-medium text-gray-600 sticky top-0">
                        <input type="checkbox" checked={list.every(o => sel.has(o.id))} onChange={e => setSel(s => { const n = new Set(s); list.forEach(o => e.target.checked ? n.add(o.id) : n.delete(o.id)); return n })} />Créneau {slot.replace('-', 'h–')}h · {list.length}
                      </label>
                      {list.map(o => (
                        <label key={o.id} className={`flex items-center gap-2 px-3 py-1.5 border-t border-gray-100 text-sm cursor-pointer ${o.late ? 'bg-red-50' : o.atRisk ? 'bg-amber-50' : ''}`}>
                          <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} />
                          <span className="font-mono text-xs text-gray-500">{o.ref.slice(-8)}</span><span className="flex-1 truncate text-gray-700">{o.district ?? '—'}</span>
                          {o.late && <span className="text-[10px] px-1.5 rounded bg-red-100 text-red-700">RETARD</span>}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                {pending.length > 0 && (
                  <div className="flex gap-2 mt-2">
                    <select value={target} onChange={e => setTarget(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                      <option value="">Assigner à…</option>{drivers.map(d => <option key={d.code} value={d.code} disabled={d.attendance === 'absent' || d.attendance === 'leave'}>{d.name} ({d.active} en cours){d.attendance === 'absent' ? ' — absent' : ''}</option>)}
                    </select>
                    <button disabled={busy || !sel.size || !target} onClick={() => run('/api/ops/dispatch/assign', { orderIds: [...sel], driverCode: target }, j => `${j.updated} commande(s) → ${target}`)} className="px-3 py-1.5 text-sm rounded-lg bg-purple-600 text-white disabled:opacity-40">Assigner ({sel.size})</button>
                  </div>
                )}
              </section>

              <section>
                <div className="text-sm font-medium text-gray-800 mb-2">Livreurs du hub</div>
                <div className="border border-gray-100 rounded-lg divide-y divide-gray-100">
                  {drivers.map(d => (
                    <div key={d.code} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="flex-1 truncate">{d.name} <span className="text-xs text-gray-400">{d.code}</span></span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.attendance === 'absent' ? 'bg-red-100 text-red-700' : d.attendance ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>{d.attendance ? ATT[d.attendance] : 'non pointé'}</span>
                      <span className="text-xs w-24 text-right"><b>{d.active}</b> en cours · <span className="text-green-700">{d.done}</span>{d.late ? <span className="text-red-600"> · {d.late} ⏰</span> : null}</span>
                    </div>
                  ))}
                  {!drivers.length && <div className="p-3 text-sm text-gray-400">Aucun livreur sur ce hub</div>}
                </div>
              </section>

              {late.length > 0 && (
                <section>
                  <div className="text-sm font-medium text-red-700 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />En retard ({late.length})</div>
                  <div className="border border-red-100 rounded-lg divide-y divide-red-50 max-h-40 overflow-y-auto">
                    {late.slice(0, 40).map(o => <div key={o.id} className="flex gap-2 px-3 py-1 text-xs bg-red-50/50"><span className="font-mono">{o.ref.slice(-8)}</span><span className="flex-1 truncate">{o.district}</span><span>{o.driverCode ?? 'non assignée'}</span></div>)}
                  </div>
                </section>
              )}

              <div className="flex gap-2 pt-1">
                <Link href={`/operations/dispatch?hub=${hub}`} className="flex-1 text-center text-sm px-3 py-2 rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50 flex items-center justify-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" />Dispatch complet</Link>
                <Link href={`/operations/suivi?hub=${hub}`} className="flex-1 text-center text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" />Suivi du hub</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
