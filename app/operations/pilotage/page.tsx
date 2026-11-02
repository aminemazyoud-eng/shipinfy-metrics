'use client'
import { useCallback, useEffect, useState } from 'react'
import { Trophy, AlertTriangle, Shuffle } from 'lucide-react'

interface Reassign { orderId: string; from: string | null; to: string; fromCode: string | null; toCode: string; reference: string; reason: 'driver_unavailable' | 'late' }
interface Prediction { orderId: string; reference: string; driver: string; overrunMin: number }
interface Standing { driverId: string; name?: string; hub: string; delivered: number; onTime: number; rate: number; rank: number; badges: string[]; streak: number }
interface Pilot { reassign: Reassign[]; predictions: Prediction[]; leaderboard: Record<string, Standing[]> }

const REASON = { driver_unavailable: 'Livreur indisponible', late: 'Retard' } as const

// Pilotage intelligent (Sprint 21) : propositions de réaffectation (validées par le dispatcher), dépassements de SLA prévus, classement par hub.
export default function PilotagePage() {
  const [data, setData] = useState<Pilot | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/ops/pilot', { cache: 'no-store' })
      if (!r.ok) throw new Error(r.status === 403 ? 'Accès refusé' : 'Chargement impossible')
      setData(await r.json()); setErr(null)
    } catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  async function apply(items: Reassign[]) {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/ops/pilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items.map(i => ({ orderId: i.orderId, from: i.from, to: i.to })) }) })
      const j = await r.json()
      setMsg(r.ok ? `${j.moved} commande(s) réaffectée(s)${j.skipped ? `, ${j.skipped} ignorée(s) (déjà modifiées)` : ''}` : j.error ?? 'Échec')
      await load()
    } finally { setBusy(false) }
  }

  if (err) return <div className="p-6 text-sm text-red-600">{err}</div>
  if (!data) return <div className="p-6 text-sm text-gray-500">Chargement…</div>

  return (
    <div className="p-4 md:p-6 space-y-6">
      <section className="bg-white border border-gray-200 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 font-semibold text-gray-900"><Shuffle size={16} /> Réaffectations proposées ({data.reassign.length})</h2>
          {data.reassign.length > 0 && <button disabled={busy} onClick={() => apply(data.reassign)} className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white disabled:opacity-60">Tout appliquer</button>}
        </div>
        {msg && <div className="mb-3 text-xs text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{msg}</div>}
        {data.reassign.length === 0 ? <p className="text-sm text-gray-500">Aucune réaffectation nécessaire.</p> : (
          <ul className="divide-y divide-gray-100">
            {data.reassign.map(r => (
              <li key={r.orderId} className="flex items-center justify-between py-2 text-sm">
                <span><b>{r.reference}</b> · {r.fromCode} → {r.toCode} <span className="text-xs text-gray-500">({REASON[r.reason]})</span></span>
                <button disabled={busy} onClick={() => apply([r])} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-60">Appliquer</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-4">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900 mb-3"><AlertTriangle size={16} /> Dépassements de SLA prévus ({data.predictions.length})</h2>
        {data.predictions.length === 0 ? <p className="text-sm text-gray-500">Aucun dépassement prévu au rythme actuel.</p> : (
          <ul className="divide-y divide-gray-100">
            {data.predictions.slice(0, 30).map(p => (
              <li key={p.orderId} className="flex items-center justify-between py-2 text-sm">
                <span><b>{p.reference}</b> · {p.driver}</span>
                <span className="text-red-600 font-medium">+{p.overrunMin} min</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-4">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900 mb-3"><Trophy size={16} /> Classement par hub (14 jours)</h2>
        {Object.keys(data.leaderboard).length === 0 ? <p className="text-sm text-gray-500">Pas encore assez de livraisons (minimum 5 par livreur).</p> : (
          <div className="grid md:grid-cols-2 gap-4">
            {Object.entries(data.leaderboard).map(([hub, rows]) => (
              <div key={hub}>
                <div className="text-xs font-semibold text-gray-500 mb-1">{hub}</div>
                <ol className="space-y-1">
                  {rows.map(s => (
                    <li key={s.driverId} className="flex items-center justify-between text-sm">
                      <span>{s.rank}. {s.name ?? s.driverId} {s.badges.map(b => <span key={b} className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{b}</span>)}</span>
                      <span className="text-gray-600">{s.onTime}/{s.delivered} · {s.rate} %</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
