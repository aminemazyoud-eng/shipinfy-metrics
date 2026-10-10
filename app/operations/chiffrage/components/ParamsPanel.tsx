'use client'
import { useEffect, useState } from 'react'
import { Save, RotateCcw } from 'lucide-react'

interface Def { key: string; label: string; unit: string; def: number; min: number; max: number; group: string; note: string }
interface Res { params: Record<string, number>; defs: Def[]; overridden: string[]; canEdit: boolean }

// Panneau Paramètres : toutes les hypothèses de coût (OpsCostParam). Lecture MANAGER, écriture ADMIN.
export default function ParamsPanel({ onSaved }: { onSaved: () => void }) {
  const [res, setRes] = useState<Res | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const load = () => fetch('/api/ops/costing/params').then(r => r.ok ? r.json() : null).then((j: Res | null) => { if (j) { setRes(j); setForm(Object.fromEntries(Object.entries(j.params).map(([k, v]) => [k, String(v)]))) } }).catch(() => {})
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!res) return
    const changed: Record<string, number> = {}
    for (const d of res.defs) { const v = Number(form[d.key].replace(',', '.')); if (Number.isFinite(v) && v !== res.params[d.key]) changed[d.key] = v }
    if (!Object.keys(changed).length) { setMsg('Aucune modification.'); return }
    const r = await fetch('/api/ops/costing/params', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changed) })
    const j = await r.json().catch(() => ({}))
    setMsg(r.ok ? 'Paramètres enregistrés.' : (j.error ?? 'Erreur')); if (r.ok) { await load(); onSaved() }
  }
  const reset = async () => {
    if (!confirm('Remettre tous les paramètres de chiffrage à leurs valeurs par défaut ?')) return
    const r = await fetch('/api/ops/costing/params', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) })
    setMsg(r.ok ? 'Valeurs par défaut rétablies.' : 'Erreur'); if (r.ok) { await load(); onSaved() }
  }
  const groups = res ? [...new Set(res.defs.map(d => d.group))] : []

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-semibold text-gray-800">Paramètres du chiffrage</div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-gray-500">{msg}</span>}
          {res?.canEdit && <><button onClick={reset} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg"><RotateCcw className="w-3.5 h-3.5" />Défauts</button>
            <button onClick={save} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white"><Save className="w-3.5 h-3.5" />Enregistrer</button></>}
        </div>
      </div>
      {res && !res.canEdit && <div className="text-xs text-gray-500">Lecture seule : la modification des paramètres est réservée aux administrateurs.</div>}
      {!res && <div className="text-sm text-gray-400">Chargement…</div>}
      {groups.map(g => (
        <div key={g}>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">{g}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {res?.defs.filter(d => d.group === g).map(d => (
              <label key={d.key} className="text-xs text-gray-500" title={d.note}>
                {d.label} <span className="text-gray-400">({d.unit})</span>{res.overridden.includes(d.key) && <span className="ml-1 text-purple-600">modifié</span>}
                <input value={form[d.key] ?? ''} disabled={!res.canEdit} onChange={e => setForm(f => ({ ...f, [d.key]: e.target.value }))} inputMode="decimal" className="block w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50" />
                {d.note && <span className="block text-[10px] text-gray-400 mt-0.5">{d.note}</span>}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
