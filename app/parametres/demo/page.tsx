'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FlaskConical, Loader2, Trash2, Sparkles, Lock } from 'lucide-react'

interface Counts { total: number; delivered: number; collected: number; pendingCollection: number; pendingAmount: number; over24h: number; over48h: number; inProgress: number; assigned: number; unassigned: number; noShow: number; cancelled: number }
interface Res { enabled: boolean; reason?: string; counts: Counts; hubs: { code: string; name: string }[]; today: string }

const mad = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} MAD`

// Paramétrage → Données de démo : génère / supprime des commandes de TEST (préfixe DEMO-) pour essayer Encaissement, Historique, Cockpit…
export default function DemoPage() {
  const [res, setRes] = useState<Res | null>(null)
  const [day, setDay] = useState('')
  const [count, setCount] = useState(120)
  const [hub, setHub] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const load = useCallback(async () => {
    const r = await fetch('/api/ops/demo', { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (r.ok) { setRes(j); setDay(d => d || j.today) } else setMsg(j.error || 'Accès réservé aux administrateurs')
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const t = setInterval(() => { void load() }, 10_000); return () => clearInterval(t) }, [load])

  const call = async (body: Record<string, unknown>, ok: (j: Record<string, unknown>) => string) => {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/ops/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(j.error || 'Échec'); return }
      setMsg(ok(j) + (Array.isArray(j.warnings) && j.warnings.length ? ` Attention : ${j.warnings.join(' ; ')}.` : ''))
      await load()
    } finally { setBusy(false) }
  }
  const seed = () => call({ action: 'seed', day, count, hub: hub || undefined }, j => `${j.created} commande(s) créée(s), ${j.skipped} déjà présente(s) (${j.events} événements).`)
  const reset = async () => { setConfirmReset(false); await call({ action: 'reset' }, j => `${j.deleted} commande(s) de démo supprimée(s).`) }

  const c = res?.counts
  const enabled = !!res?.enabled
  const input = 'border border-gray-300 rounded-lg px-2 py-1.5 text-sm disabled:bg-gray-50'
  const tile = (label: string, value: string | number, cls = 'text-gray-900') => (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${cls}`}>{value}</p>
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><FlaskConical className="w-5 h-5 text-purple-600" />Données de démonstration</h1>
        <p className="text-sm text-gray-500">Pour tester sans back-office ; ne génère aucune notification ni envoi externe. Les commandes créées portent le préfixe <span className="font-mono">DEMO-</span> et se suppriment d&apos;un clic, sans toucher aux autres données.</p>
      </div>

      {msg && <div className="text-sm bg-purple-50 border border-purple-200 text-purple-800 rounded-lg p-3">{msg}</div>}
      {res && !enabled && (
        <div className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3"><Lock className="w-4 h-4" />{res.reason || 'Désactivé : source de données réelle'}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">Jour<br /><input type="date" className={input} disabled={!enabled || busy} value={day} onChange={e => setDay(e.target.value)} /></label>
          <label className="text-xs text-gray-600">Nombre de commandes (20 – 300)<br /><input type="number" min={20} max={300} className={`${input} w-28`} disabled={!enabled || busy} value={count} onChange={e => setCount(Number(e.target.value))} /></label>
          <label className="text-xs text-gray-600">Hub<br />
            <select className={input} disabled={!enabled || busy} value={hub} onChange={e => setHub(e.target.value)}>
              <option value="">Tous les hubs</option>
              {res?.hubs.map(h => <option key={h.code} value={h.code}>{h.code} — {h.name}</option>)}
            </select>
          </label>
          <button onClick={seed} disabled={!enabled || busy || !day} className="inline-flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}Générer
          </button>
          {!confirmReset ? (
            <button onClick={() => setConfirmReset(true)} disabled={!enabled || busy || !c?.total} className="inline-flex items-center gap-1.5 border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 text-sm font-medium rounded-lg px-4 py-2">
              <Trash2 className="w-4 h-4" />Supprimer les données de démo
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm">
              <span className="text-red-700">Supprimer {c?.total} commande(s) de démo ?</span>
              <button onClick={reset} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-1.5">Confirmer</button>
              <button onClick={() => setConfirmReset(false)} className="border border-gray-300 rounded-lg px-3 py-1.5">Annuler</button>
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">Répartition par défaut : ~45 % livrées non encaissées (dont des commandes de plus de 24 h et 48 h), ~15 % encaissées, ~15 % en cours, ~10 % assignées, ~8 % non assignées, ~4 % non livrées, ~3 % annulées. Relancer la génération du même jour ne crée pas de doublons.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tile('Commandes de démo', c?.total ?? '—')}
        {tile('À encaisser', c ? `${c.pendingCollection} · ${mad(c.pendingAmount)}` : '—', 'text-amber-700')}
        {tile('> 24 h non encaissées', c?.over24h ?? '—', 'text-amber-700')}
        {tile('> 48 h non encaissées', c?.over48h ?? '—', 'text-red-700')}
        {tile('Livrées', c?.delivered ?? '—')}
        {tile('Encaissées', c?.collected ?? '—', 'text-green-700')}
        {tile('En cours', c?.inProgress ?? '—')}
        {tile('Assignées', c?.assigned ?? '—')}
        {tile('Non assignées', c?.unassigned ?? '—')}
        {tile('Non livrées', c?.noShow ?? '—')}
        {tile('Annulées', c?.cancelled ?? '—')}
      </div>

      <p className="text-sm text-gray-600">
        Voir le résultat : <Link href="/operations" className="text-purple-700 underline">Cockpit live</Link> → <Link href="/operations/encaissement" className="text-purple-700 underline">Encaissement</Link>.
      </p>
    </div>
  )
}
