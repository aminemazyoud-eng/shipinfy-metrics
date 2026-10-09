'use client'
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Truck, Wand2, RefreshCw, MapPin, ArrowRightLeft, AlertTriangle, Clock, UserCheck, UserX } from 'lucide-react'
import OpsNav from '../components/OpsNav'
import { usePolling } from '@/lib/use-polling'

interface Hub { code: string; name: string; city: string; toDispatch?: number }
interface Order { id: string; ref: string; status: string; slotStart: string; slotEnd: string; slotLabel: string | null; district: string | null; amount: number | null; customer: string | null; driverCode: string | null; late: boolean; atRisk: boolean }
interface Driver { code: string; driving?: { ok: boolean; reasons: string[] }; name: string; hubCode: string | null; vehicle: string | null; plate: string | null; helper?: string | null; attendance: string | null; active: number; done: number; late: number }
interface Data { day: string; hubCode: string; hubs: Hub[]; orders: Order[]; drivers: Driver[] }

const STATUS_LABEL: Record<string, string> = { READY_PICKUP: 'À dispatcher', ASSIGNED: 'Assignée', IN_TRANSPORT: 'En transport', START_DELIVERY: 'En livraison', DELIVERED: 'Livrée', NO_SHOW: 'NO_SHOW' }
const ATT: Record<string, { l: string; c: string }> = { present: { l: 'Présent', c: 'bg-green-100 text-green-700' }, late: { l: 'En retard', c: 'bg-amber-100 text-amber-700' }, absent: { l: 'Absent', c: 'bg-red-100 text-red-700' }, leave: { l: 'Congé', c: 'bg-gray-100 text-gray-600' } }

export default function DispatchPage() {
  return <Suspense fallback={null}><Dispatch /></Suspense>
}

function Dispatch() {
  const sp = useSearchParams()
  const [hub, setHub] = useState<string>(sp.get('hub') ?? '')
  const [day, setDay] = useState(sp.get('day') ?? 'today')
  const [data, setData] = useState<Data | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null)
  const [openDriver, setOpenDriver] = useState<string | null>(null)

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ day }); if (hub) qs.set('hub', hub)
    const r = await fetch(`/api/ops/dispatch?${qs}`); const j = await r.json()
    if (!r.ok) { setMsg({ t: 'err', s: j.error || 'Erreur' }); return }
    setData(j); if (!hub) setHub(j.hubCode)
  }, [hub, day])

  useEffect(() => { load() }, [load])
  usePolling(load, 20_000)

  const call = async (url: string, body: unknown, ok: (j: Record<string, unknown>) => string) => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      setMsg(r.ok ? { t: 'ok', s: ok(j) } : { t: 'err', s: j.error || 'Erreur' })
      if (r.ok) { setSel(new Set()); await load() }
    } finally { setBusy(false) }
  }

  const assign = (driverCode: string | null, ids: string[]) => call('/api/ops/dispatch/assign', { orderIds: ids, driverCode }, j => `${j.updated} commande(s) ${driverCode ? `→ ${driverCode}` : 'retirée(s)'}`)
  const auto = () => call('/api/ops/dispatch/auto', { hub, day }, j => `Auto-dispatch : ${j.assigned ?? 0} commande(s) réparties`)
  const moveDriver = (code: string, to: string) => call(`/api/ops/drivers/${code}/hub`, { hubCode: to }, () => `${code} → ${to}`)

  const unassigned = useMemo(() => (data?.orders ?? []).filter(o => !o.driverCode && o.status !== 'DELIVERED' && o.status !== 'NO_SHOW'), [data])
  const bySlot = useMemo(() => {
    const m = new Map<string, Order[]>()
    for (const o of unassigned) { const k = o.slotLabel || '—'; (m.get(k) ?? m.set(k, []).get(k)!).push(o) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [unassigned])
  const mine = (data?.drivers ?? []).filter(d => d.hubCode === data?.hubCode)
  const others = (data?.drivers ?? []).filter(d => d.hubCode !== data?.hubCode)
  const lateCount = (data?.orders ?? []).filter(o => o.late).length
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const cities = useMemo(() => [...new Set((data?.hubs ?? []).map(h => h.city))], [data])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Truck className="w-5 h-5 text-purple-600" />Dispatch live</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-300 overflow-hidden bg-white text-sm">
            {[['today', "Aujourd'hui"], ['tomorrow', 'Demain']].map(([v, l]) => <button key={v} onClick={() => setDay(v)} className={`px-3 py-1.5 ${day === v ? 'bg-purple-600 text-white' : 'hover:bg-gray-50'}`}>{l}</button>)}
          </div>
          <button onClick={load} className="p-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>
      <OpsNav />

      <div className="flex flex-wrap gap-4">
        {cities.map(c => (
          <div key={c} className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">{c}</span>
            {(data?.hubs ?? []).filter(h => h.city === c).map(h => (
              <button key={h.code} onClick={() => { setHub(h.code); setSel(new Set()) }} className={`px-3 py-1.5 rounded-lg text-sm border ${hub === h.code ? 'bg-purple-600 text-white border-purple-600' : 'bg-white border-gray-300 hover:bg-gray-50'}`}>{h.name.replace('Marjane ', '')}{h.toDispatch ? <span className={`ml-1.5 text-[10px] px-1.5 rounded-full ${hub === h.code ? 'bg-white/25' : 'bg-amber-100 text-amber-700'}`}>{h.toDispatch}</span> : null}</button>
            ))}
          </div>
        ))}
      </div>

      {msg && <div className={`text-sm rounded-lg p-3 border ${msg.t === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.s}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['À dispatcher', unassigned.length, 'text-amber-600'], ['Assignées / en cours', (data?.orders ?? []).filter(o => o.driverCode && o.status !== 'DELIVERED' && o.status !== 'NO_SHOW').length, 'text-gray-900'],
          ['Livrées', (data?.orders ?? []).filter(o => o.status === 'DELIVERED').length, 'text-green-600'], ['En retard', lateCount, lateCount ? 'text-red-600' : 'text-green-600']].map(([l, v, c]) => (
          <div key={l as string} className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">{l}</div><div className={`text-2xl font-bold ${c}`}>{v}</div></div>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* Commandes à dispatcher */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl">
          <div className="p-3 border-b border-gray-100 flex items-center justify-between">
            <div className="font-medium text-gray-800 text-sm">Commandes à dispatcher <span className="text-gray-400">({unassigned.length})</span></div>
            <button disabled={busy || !unassigned.length} onClick={auto} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-purple-600 text-white disabled:opacity-40"><Wand2 className="w-3.5 h-3.5" />Auto-dispatch</button>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {!bySlot.length && <div className="p-6 text-center text-sm text-gray-400">Tout est dispatché 🎉</div>}
            {bySlot.map(([slot, list]) => (
              <div key={slot}>
                <label className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-600 sticky top-0">
                  <input type="checkbox" checked={list.every(o => sel.has(o.id))} onChange={e => setSel(s => { const n = new Set(s); list.forEach(o => e.target.checked ? n.add(o.id) : n.delete(o.id)); return n })} />
                  Créneau {slot.replace('-', 'h–')}h · {list.length}
                </label>
                {list.map(o => (
                  <label key={o.id} className={`flex items-center gap-2 px-3 py-2 border-t border-gray-100 text-sm cursor-pointer ${o.late ? 'bg-red-50' : o.atRisk ? 'bg-amber-50' : ''}`}>
                    <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} />
                    <span className="font-mono text-xs text-gray-500">{o.ref.slice(-8)}</span>
                    <span className="flex-1 truncate text-gray-700">{o.district || o.customer || '—'}</span>
                    {o.late && <span className="text-[10px] px-1.5 rounded bg-red-100 text-red-700">RETARD</span>}
                    {o.atRisk && <span className="text-[10px] px-1.5 rounded bg-amber-100 text-amber-700">RISQUE</span>}
                    <span className="text-xs text-gray-400">{o.amount ? `${Math.round(o.amount)} MAD` : ''}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Livreurs */}
        <div className="lg:col-span-3 space-y-3">
          <div className="text-sm text-gray-600 flex items-center gap-2">{sel.size ? <b>{sel.size} commande(s) sélectionnée(s) — cliquez « Assigner » sur un livreur</b> : 'Sélectionnez des commandes puis assignez-les à un livreur'}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {mine.map(d => {
              const a = d.attendance ? ATT[d.attendance] : null
              const blocked = d.attendance === 'absent' || d.attendance === 'leave'
              const myOrders = (data?.orders ?? []).filter(o => o.driverCode === d.code && o.status !== 'DELIVERED' && o.status !== 'NO_SHOW')
              return (
                <div key={d.code} className={`bg-white border rounded-xl p-3 ${d.late ? 'border-red-300' : 'border-gray-200'} ${blocked ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div><div className="font-medium text-gray-900 text-sm">{d.name} <span className="text-xs text-gray-400">{d.code}</span>{d.driving && !d.driving.ok && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700" title={d.driving.reasons.join(', ')}>⚠ non apte : {d.driving.reasons[0]}</span>}</div><div className="text-xs text-gray-400">{d.vehicle ?? '—'} {d.plate ?? ''}{d.helper ? ` · helper ${d.helper}` : ''}</div></div>
                    {a ? <span className={`text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 ${a.c}`}>{d.attendance === 'absent' ? <UserX className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}{a.l}</span> : <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">non pointé</span>}
                  </div>
                  <div className="flex gap-3 mt-2 text-xs"><span><b>{d.active}</b> en cours</span><span className="text-green-700"><b>{d.done}</b> livrées</span><span className={d.late ? 'text-red-600 font-semibold' : 'text-gray-400'}><b>{d.late}</b> retard</span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-purple-500" style={{ width: `${Math.min(100, (d.active / 8) * 100)}%` }} /></div>
                  <div className="flex gap-2 mt-3">
                    <button disabled={busy || !sel.size || blocked} onClick={() => assign(d.code, [...sel])} className="flex-1 text-xs py-1.5 rounded-lg bg-purple-600 text-white disabled:opacity-30">Assigner ({sel.size})</button>
                    <button onClick={() => setOpenDriver(openDriver === d.code ? null : d.code)} className="text-xs px-2 py-1.5 rounded-lg border border-gray-300">{myOrders.length} cmd</button>
                    <select value="" onChange={e => e.target.value && moveDriver(d.code, e.target.value)} className="text-xs border border-gray-300 rounded-lg px-1 w-24" title="Changer de hub">
                      <option value="">⇄ Hub</option>{(data?.hubs ?? []).filter(h => h.code !== d.hubCode).map(h => <option key={h.code} value={h.code}>{h.name.replace('Marjane ', '')}</option>)}
                    </select>
                  </div>
                  {openDriver === d.code && (
                    <div className="mt-2 border-t border-gray-100 pt-2 space-y-1 max-h-40 overflow-y-auto">
                      {myOrders.map(o => (
                        <div key={o.id} className={`flex items-center gap-2 text-xs rounded px-1.5 py-1 ${o.late ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
                          <span className="font-mono">{o.ref.slice(-8)}</span><span className="flex-1 truncate">{o.district}</span><span>{STATUS_LABEL[o.status]}</span>
                          {o.status === 'ASSIGNED' && <button onClick={() => assign(null, [o.id])} className="text-red-500">✕</button>}
                        </div>
                      ))}
                      {!myOrders.length && <div className="text-xs text-gray-400">Aucune commande en cours</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {!mine.length && <div className="text-sm text-gray-400">Aucun livreur sur ce hub — rapatriez un renfort ci-dessous.</div>}

          <details className="bg-white border border-gray-200 rounded-xl">
            <summary className="px-3 py-2 text-sm font-medium text-gray-700 cursor-pointer flex items-center gap-2"><ArrowRightLeft className="w-4 h-4" />Renforts d&apos;autres hubs ({others.length})</summary>
            <div className="grid sm:grid-cols-2 gap-2 p-3 border-t border-gray-100">
              {others.map(d => (
                <div key={d.code} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <div><div>{d.name} <span className="text-xs text-gray-400">{d.code}</span></div><div className="text-xs text-gray-400 flex items-center gap-1"><MapPin className="w-3 h-3" />{d.hubCode} · {d.active} en cours</div></div>
                  <button disabled={busy} onClick={() => moveDriver(d.code, data!.hubCode)} className="text-xs px-2.5 py-1 rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50">Rapatrier ici</button>
                </div>
              ))}
            </div>
          </details>
          <div className="flex gap-4 text-xs text-gray-400"><span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-red-500" />rouge = en retard</span><span className="flex items-center gap-1"><Clock className="w-3 h-3 text-amber-500" />orange = fin de créneau &lt; 45 min</span></div>
        </div>
      </div>
    </div>
  )
}
