'use client'
import { useState, useEffect, useCallback } from 'react'
import { Download, Lock, CheckCircle2 } from 'lucide-react'
import { usePolling } from '@/lib/use-polling'

interface Closed { declared: number; gap: number; note: string | null; closedBy: string | null; closedAt: string }
interface DriverRow { code: string; name: string; expected: number; count: number; closed: Closed | null }
interface Hist { id: string; day: string; driverCode: string; expected: number; declared: number; gap: number; note: string | null; closedBy: string | null; closedAt: string }
interface Res { day: string; hubCode: string; gapAlert: number; drivers: DriverRow[]; hub: { expected: number; count: number; closed: Closed | null }; history: Hist[] }

const mad = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('fr-FR')} MAD`
const signed = (n: number) => `${n > 0 ? '+' : ''}${(Math.round(n * 100) / 100).toLocaleString('fr-FR')}`
const iso = (d: Date) => d.toISOString().slice(0, 10)
const today = () => iso(new Date(Date.now() + 3_600_000))

// Clôture du jour : le livreur remet l'argent encaissé → on compare au montant attendu (commandes livrées du jour) et on fige l'écart.
export default function ClotureCaisse({ hubs }: { hubs: { code: string; name: string }[] }) {
  const [hub, setHub] = useState('')
  const [day, setDay] = useState(today())
  const [res, setRes] = useState<Res | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ ok: boolean; s: string } | null>(null)
  const [busy, setBusy] = useState('')

  useEffect(() => { if (!hub && hubs.length) setHub(hubs[0].code) }, [hubs, hub])
  const load = useCallback(async () => {
    if (!hub) return
    const r = await fetch(`/api/ops/cash/close?day=${day}&hub=${encodeURIComponent(hub)}`)
    if (r.ok) setRes(await r.json()); else setMsg({ ok: false, s: (await r.json().catch(() => ({}))).error || 'Chargement impossible' })
  }, [hub, day])
  useEffect(() => { load() }, [load])
  usePolling(load, 60_000)

  const close = async (key: string, driverCode: string, expected: number) => {
    const declared = Number((vals[key] ?? '').replace(',', '.'))
    if (vals[key] == null || vals[key] === '' || !Number.isFinite(declared) || declared < 0) { setMsg({ ok: false, s: 'Saisissez le montant remis (nombre positif).' }); return }
    const gap = declared - expected
    if (Math.abs(gap) > (res?.gapAlert ?? 50) && !window.confirm(`Écart de ${signed(gap)} MAD (seuil d'alerte ${res?.gapAlert} MAD). Confirmer la clôture ?`)) return
    setBusy(key); setMsg(null)
    const r = await fetch('/api/ops/cash/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, hubCode: hub, driverCode, declared, note: notes[key] || undefined }) })
    const j = await r.json().catch(() => ({})); setBusy('')
    if (r.ok) { setMsg({ ok: true, s: `Clôturé — écart ${signed(j.gap)} MAD${j.alert ? ' (alerte enregistrée)' : ''}.` }); setVals(v => ({ ...v, [key]: '' })); load() }
    else setMsg({ ok: false, s: r.status === 409 ? 'Déjà clôturé pour ce jour, ce hub et ce livreur.' : j.error || 'Erreur' })
  }

  const gapCls = (g: number) => (Math.abs(g) > (res?.gapAlert ?? 50) ? 'bg-red-100 text-red-700' : Math.abs(g) >= 0.01 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')
  const Row = ({ k, code, name, expected, count, closed }: { k: string; code: string; name: string; expected: number; count: number; closed: Closed | null }) => {
    const raw = vals[k] ?? '', n = Number(raw.replace(',', '.')), live = raw !== '' && Number.isFinite(n) ? n - expected : null
    return (
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
        <div className="flex-1 min-w-40"><span className="font-medium text-gray-900">{name}</span> {code && <span className="text-xs text-gray-400">{code}</span>}<div className="text-[11px] text-gray-400">{count} commande(s) livrée(s)</div></div>
        <div className="w-28 text-right"><div className="text-[11px] text-gray-400">Attendu</div><div className="font-semibold">{mad(expected)}</div></div>
        {closed ? (
          <>
            <div className="w-28 text-right"><div className="text-[11px] text-gray-400">Remis</div><div className="font-semibold">{mad(closed.declared)}</div></div>
            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${gapCls(closed.gap)}`}>Écart {signed(closed.gap)}</span>
            <span className="text-xs text-gray-400 flex items-center gap-1"><Lock className="w-3 h-3" />Clôturé{closed.closedBy ? ` par ${closed.closedBy}` : ''}</span>
          </>
        ) : (
          <>
            <input value={raw} inputMode="decimal" onChange={e => setVals(v => ({ ...v, [k]: e.target.value }))} placeholder="Remis (MAD)" className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
            <span className={`text-xs px-2 py-1 rounded-full font-semibold w-28 text-center ${live == null ? 'bg-gray-100 text-gray-400' : gapCls(live)}`}>{live == null ? 'Écart —' : `Écart ${signed(live)}`}</span>
            <input value={notes[k] ?? ''} onChange={e => setNotes(v => ({ ...v, [k]: e.target.value }))} placeholder="Note" maxLength={200} className="w-36 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
            <button onClick={() => close(k, code, expected)} disabled={busy === k} className="px-3 py-1.5 text-sm rounded-lg bg-green-600 text-white disabled:opacity-40">Clôturer</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Hub<select value={hub} onChange={e => setHub(e.target.value)} className="block border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">{hubs.map(h => <option key={h.code} value={h.code}>{h.name.replace('Marjane ', '')}</option>)}</select></label>
        <label className="text-xs text-gray-500">Jour<input type="date" value={day} max={today()} onChange={e => setDay(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <a href={`/api/ops/cash/close?hub=${encodeURIComponent(hub)}&format=xlsx`} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-purple-600 text-white"><Download className="w-4 h-4" />Export Excel (14 jours)</a>
      </div>
      <p className="text-sm text-gray-500">Attendu = somme des commandes <b>livrées</b> ce jour-là (montant encaissé si déjà encaissé, sinon montant de la commande). Écart = remis − attendu ; au-delà de {res?.gapAlert ?? 50} MAD il est signalé. Une clôture est définitive.</p>
      {msg && <div className={`text-sm rounded-lg p-3 border ${msg.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.s}</div>}

      {res && (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {res.drivers.map(d => <Row key={d.code} k={d.code} code={d.code} name={d.name} expected={d.expected} count={d.count} closed={d.closed} />)}
          {!res.drivers.length && <div className="p-8 text-center text-gray-400"><CheckCircle2 className="w-8 h-8 mx-auto text-green-500 mb-2" />Aucune livraison ce jour-là sur ce hub</div>}
          {res.drivers.length > 0 && <div className="bg-gray-50"><Row k="__hub" code="" name="Total du hub (remise globale)" expected={res.hub.expected} count={res.hub.count} closed={res.hub.closed} /></div>}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <div className="p-3 text-sm font-medium text-gray-700 border-b border-gray-100">Historique des 14 derniers jours</div>
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 text-left"><th className="p-2 pl-3 font-medium">Jour</th><th className="p-2 font-medium">Livreur</th><th className="p-2 font-medium text-right">Attendu</th><th className="p-2 font-medium text-right">Remis</th><th className="p-2 font-medium text-right">Écart</th><th className="p-2 font-medium">Note</th><th className="p-2 font-medium">Par</th></tr></thead>
          <tbody>
            {res?.history.map(h => (
              <tr key={h.id} className="border-t border-gray-100">
                <td className="p-2 pl-3 font-mono text-xs text-gray-500">{h.day}</td><td className="p-2">{h.driverCode || <span className="text-gray-500">Total hub</span>}</td>
                <td className="p-2 text-right">{mad(h.expected)}</td><td className="p-2 text-right">{mad(h.declared)}</td>
                <td className="p-2 text-right"><span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${gapCls(h.gap)}`}>{signed(h.gap)}</span></td>
                <td className="p-2 text-gray-500 max-w-48 truncate">{h.note ?? ''}</td><td className="p-2 text-gray-400 text-xs">{h.closedBy ?? ''}</td>
              </tr>
            ))}
            {res && !res.history.length && <tr><td colSpan={7} className="p-4 text-center text-xs text-gray-400">Aucune clôture sur 14 jours</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
