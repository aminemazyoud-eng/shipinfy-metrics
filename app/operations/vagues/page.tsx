'use client'
import { useState, useEffect, useCallback } from 'react'
import { Layers, RefreshCw, Printer, FileSpreadsheet, Play, Eye } from 'lucide-react'
import OpsNav from '../components/OpsNav'

interface WOrder { rank: number; id: string; ref: string; district: string | null; sector: string | null; slot: string; slotEnd: string; status: string; address: string | null; customer: string | null; extended: boolean }
interface Lot { n: number; waveId: string; sector: string | null; hubCode: string | null; earliestEnd: string; orders: WOrder[] }
interface Res { day: string; slot: string | null; hub: string | null; params: { target: number; max: number; widenMin: number }; slots: string[]; lots: Lot[]; orders: number; extended?: number; cleared?: number; dryRun?: boolean }

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' })
const ST: Record<string, string> = { READY_PICKUP: 'À dispatcher', ASSIGNED: 'Assignée' }

export default function VaguesPage() {
  const [day, setDay] = useState('today')
  const [slot, setSlot] = useState('')
  const [hub, setHub] = useState('')
  const [widen, setWiden] = useState(true)
  const [hubs, setHubs] = useState<{ code: string; name: string }[]>([])
  const [slots, setSlots] = useState<string[]>([])
  const [res, setRes] = useState<Res | null>(null)
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)

  const qs = useCallback(() => { const q = new URLSearchParams({ day }); if (slot) q.set('slot', slot); if (hub) q.set('hub', hub); return q }, [day, slot, hub])
  const load = useCallback(async () => {
    const r = await fetch(`/api/ops/waves?${qs()}`)
    if (r.ok) { const j: Res = await r.json(); setRes(j); setSlots(j.slots); if (!slot && j.slots.length) setSlot(j.slots[0]) }
  }, [qs, slot])
  useEffect(() => { load() }, [load])
  useEffect(() => { fetch('/api/ops/hubs').then(r => r.ok ? r.json() : null).then(j => j && setHubs(j.hubs)).catch(() => {}) }, [])
  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(''), 6000) }

  const run = async (dryRun: boolean) => {
    if (!slot) return
    setBusy(true)
    const r = await fetch('/api/ops/waves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, slot, hub: hub || undefined, dryRun, ...(widen ? {} : { widenMin: 0 }) }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { say(j.error ?? 'Échec du calcul'); return }
    setRes({ ...j, slots }); say(dryRun ? `Aperçu : ${j.lots.length} lot(s), ${j.orders} commande(s) — rien n'est enregistré` : `Vague enregistrée : ${j.lots.length} lot(s), ${j.orders} commande(s)${j.extended ? ` dont ${j.extended} de la fenêtre élargie` : ''}`)
  }
  const xlsx = () => { const q = qs(); q.set('format', 'xlsx'); window.location.href = `/api/ops/waves?${q}` }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Layers className="w-5 h-5 text-purple-600" />Vagues de préparation</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select value={day} onChange={e => setDay(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"><option value="today">Aujourd&apos;hui</option><option value="tomorrow">Demain</option></select>
          <select value={slot} onChange={e => setSlot(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">{slots.map(s => <option key={s} value={s}>Créneau {s}</option>)}</select>
          <select value={hub} onChange={e => setHub(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"><option value="">Tous les hubs</option>{hubs.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}</select>
          <label className="text-sm text-gray-600 flex items-center gap-1"><input type="checkbox" checked={widen} onChange={e => setWiden(e.target.checked)} />Fenêtre élargie{res ? ` (+${Math.round(res.params.widenMin / 60 * 10) / 10} h)` : ''}</label>
        </div>
      </div>
      <div className="print:hidden"><OpsNav /></div>
      <div className="flex flex-wrap gap-2 print:hidden">
        <button onClick={() => run(true)} disabled={busy || !slot} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"><Eye className="w-4 h-4" />Aperçu</button>
        <button onClick={() => run(false)} disabled={busy || !slot} className="px-3 py-1.5 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1"><Play className="w-4 h-4" />Lancer la vague</button>
        <button onClick={load} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"><RefreshCw className="w-4 h-4" /></button>
        <button onClick={() => window.print()} disabled={!res?.lots.length} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1"><Printer className="w-4 h-4" />Imprimer</button>
        <button onClick={xlsx} disabled={!res?.lots.length} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1"><FileSpreadsheet className="w-4 h-4" />Excel</button>
      </div>
      {flash && <div className="rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm px-3 py-2 print:hidden">{flash}</div>}
      {res && <p className="text-sm text-gray-500 print:hidden">Lots de {res.params.target} à {res.params.max} commandes, regroupés par secteur puis par proximité : préparez dans l&apos;ordre des lots, pas dans l&apos;ordre d&apos;arrivée. La fenêtre élargie ajoute les commandes du créneau suivant qui démarrent dans les {res.params.widenMin} min après la fin du créneau (réglage dans Tournées → Réglages).</p>}
      <h2 className="hidden print:block text-lg font-bold">Vague {slot} — {res?.day}{hub ? ` — ${hub}` : ''}</h2>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {res?.lots.map(l => (
          <div key={l.waveId} className="rounded-xl border border-gray-200 bg-white p-3 break-inside-avoid">
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold text-gray-900">Lot {l.n} <span className="font-normal text-sm text-gray-500">· {l.sector ?? 'sans secteur'}{l.hubCode ? ` · ${l.hubCode}` : ''}</span></div>
              <div className="text-xs text-gray-500">avant {hhmm(l.earliestEnd)}</div>
            </div>
            <ol className="space-y-1.5">
              {l.orders.map(o => (
                <li key={o.id} className="flex gap-2 text-sm">
                  <span className="w-5 h-5 shrink-0 rounded-full bg-purple-100 text-purple-800 text-xs font-bold flex items-center justify-center">{o.rank}</span>
                  <span><span className="font-mono">{o.ref}</span> <span className="text-gray-500 text-xs">{o.district ?? ''} · {ST[o.status] ?? o.status} · fin {hhmm(o.slotEnd)}</span>{o.extended && <span className="ml-1 text-[10px] bg-amber-100 text-amber-800 px-1 rounded">élargie</span>}
                    {o.address && <span className="block text-xs text-gray-400 truncate max-w-[22rem]">{o.address}</span>}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      {res && slot && !res.lots.length && <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-400 text-sm print:hidden">Aucune vague enregistrée pour ce créneau. Cliquez « Aperçu » pour voir les lots, puis « Lancer la vague ».</div>}
    </div>
  )
}
