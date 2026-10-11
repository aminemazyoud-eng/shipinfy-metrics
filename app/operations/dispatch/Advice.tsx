'use client'
import { useEffect, useState } from 'react'
import { Sparkles, Gauge, Layers, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react'

// Aide à la décision du Dispatch live — reprend les fonctions uniques de l'ancien /dispatch, sur les données TEMPS RÉEL :
// avancement global, statut des livreurs, assignation conseillée (aperçu non enregistré) et regroupement intelligent (bundling).
interface Ord { id: string; status: string; driverCode: string | null }
interface Drv { code: string; name: string; hubCode: string | null; active: number; done: number; late: number; attendance: string | null }
interface Bundle { orderIds: string[]; zone: string; estimatedSaving: number; refs: string[]; unassigned: number }
interface Preview { code: string; count: number }

export default function Advice({ hub, day, orders, drivers, toDispatch }: { hub: string; day: string; orders: Ord[]; drivers: Drv[]; toDispatch: number }) {
  const [bundles, setBundles] = useState<Bundle[] | null>(null)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<{ assigned: number; summary: Preview[] } | null>(null)
  const [previewMsg, setPreviewMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!hub) return
    let cancelled = false
    setPreview(null); setPreviewMsg('')
    fetch(`/api/ops/dispatch/bundles?hub=${hub}&day=${day}`).then(r => r.ok ? r.json() : null).then(j => { if (!cancelled && j) setBundles(j.bundles) }).catch(() => {})
    return () => { cancelled = true }
  }, [hub, day])

  const runPreview = async () => {
    setBusy(true); setPreviewMsg('')
    try {
      const r = await fetch('/api/ops/dispatch/auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hub, day, dryRun: true }) })
      const j = await r.json()
      if (r.ok && j.summary) setPreview({ assigned: j.assigned ?? 0, summary: j.summary }); else { setPreview(null); setPreviewMsg(j.error || j.message || 'Aucune proposition') }
    } finally { setBusy(false) }
  }
  const toggle = (i: number) => setOpen(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })

  const total = orders.length
  const done = orders.filter(o => o.status === 'DELIVERED' || o.status === 'NO_SHOW').length
  const pct = total ? Math.round(done / total * 100) : 0
  const mine = drivers.filter(d => d.hubCode === hub)
  const nameOf = (code: string) => drivers.find(d => d.code === code)?.name ?? code

  return (
    <details className="bg-white border border-gray-200 rounded-xl" open>
      <summary className="px-3 py-2 text-sm font-medium text-gray-700 cursor-pointer flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-600" />Aide à la décision : avancement, statut livreurs, assignation conseillée, regroupements</summary>
      <div className="p-3 border-t border-gray-100 space-y-4">
        {total > 0 && (
          <div>
            <div className="flex justify-between text-sm mb-1.5"><span className="font-medium text-gray-700 flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-purple-600" />Avancement global</span><span className="text-gray-500">{done}/{total} commandes terminées ({pct}%)</span></div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626' }} /></div>
          </div>
        )}

        <div>
          <div className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-2"><Gauge className="w-4 h-4 text-purple-600" />Statut livreurs temps réel</div>
          {mine.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {mine.map(d => {
                const b = d.active === 0 ? { t: 'LIBRE', c: 'bg-green-100 text-green-800', col: '#16a34a' } : d.active < 6 ? { t: 'EN LIVRAISON', c: 'bg-orange-100 text-orange-800', col: '#d97706' } : { t: 'CHARGÉ', c: 'bg-red-100 text-red-800', col: '#dc2626' }
                const all = d.active + d.done
                return (
                  <div key={d.code} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-2"><span className="font-medium text-sm text-gray-900 truncate">{d.name}</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${b.c}`}>{b.t}</span></div>
                    <div className="flex items-center gap-2 mb-1"><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${all ? Math.round(d.done / all * 100) : 0}%`, background: b.col }} /></div><span className="text-[10px] text-gray-500">{d.done}/{all}</span></div>
                    <div className="flex justify-between text-[10px] text-gray-400"><span>{d.active} en cours</span><span>{d.late ? `${d.late} en retard` : 'à l’heure'}</span></div>
                  </div>
                )
              })}
            </div>
          ) : <p className="text-xs text-gray-400">Aucun livreur sur ce hub.</p>}
        </div>

        <div>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <div className="text-sm font-bold text-gray-900 flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-600" />Assignation conseillée</div>
            <button onClick={runPreview} disabled={busy || !toDispatch} className="px-3 py-1.5 rounded-lg border border-purple-300 text-purple-700 text-xs font-medium hover:bg-purple-50 disabled:opacity-40">{busy ? '…' : 'Proposer une répartition (aperçu)'}</button>
          </div>
          <p className="text-[11px] text-gray-400 mb-2">{toDispatch} commande(s) à répartir · aperçu non enregistré — utilisez « Auto-dispatch » pour appliquer.</p>
          {preview && preview.summary.length > 0 ? (
            <table className="w-full text-xs"><thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 pr-3 font-medium">Livreur</th><th className="py-1.5 font-medium">Nb assigné</th></tr></thead>
              <tbody>{preview.summary.filter(s => s.count > 0).sort((a, b) => b.count - a.count).map(s => <tr key={s.code} className="border-b border-gray-50"><td className="py-1.5 pr-3 font-medium text-gray-800">{nameOf(s.code)} <span className="text-gray-400">{s.code}</span></td><td className="py-1.5 text-gray-700">{s.count}</td></tr>)}</tbody></table>
          ) : <p className="text-xs text-gray-400">{previewMsg || 'Cliquez pour générer une proposition de répartition.'}</p>}
        </div>

        <div>
          <div className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-2"><Layers className="w-4 h-4 text-purple-600" />Regroupement intelligent (bundling)</div>
          {bundles && bundles.length > 0 ? (
            <div className="space-y-2">
              {bundles.map((b, i) => (
                <div key={i} className="border border-gray-200 rounded-lg">
                  <button onClick={() => toggle(i)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50">
                    <span className="font-medium text-sm text-gray-800">{b.zone}</span><span className="text-xs text-gray-400">{b.orderIds.length} commandes{b.unassigned ? ` · ${b.unassigned} à dispatcher` : ''}</span>
                    <span className="ml-auto text-xs text-green-700 font-medium">≈ {b.estimatedSaving} min économisées</span>
                    {open.has(i) ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                  </button>
                  {open.has(i) && <div className="border-t border-gray-100 px-3 py-2 flex flex-wrap gap-1.5">{b.refs.map((r, j) => <span key={j} className="font-mono text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{r}</span>)}</div>}
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">Aucun regroupement détecté (moins de 2 commandes par zone).</p>}
        </div>
      </div>
    </details>
  )
}
