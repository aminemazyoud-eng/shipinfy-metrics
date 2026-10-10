'use client'
import { useCallback, useEffect, useState } from 'react'
import { ListChecks, Plus, Save, Trash2, Lock } from 'lucide-react'

interface Reason { code: string; label: string; labelAr: string | null; kind: string; cod: boolean; rto: boolean; sort: number; active: boolean }
const EMPTY: Reason = { code: '', label: '', labelAr: '', kind: 'NON_DELIVERY', cod: false, rto: true, sort: 100, active: true }

// Paramétrage → Motifs de non-livraison : nomenclature utilisée par l'application livreur (Non livré) et lue dans le détail des commandes.
export default function MotifsPage() {
  const [rows, setRows] = useState<Reason[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [msg, setMsg] = useState('')
  const [draft, setDraft] = useState<Reason>(EMPTY)

  const load = useCallback(async () => {
    const r = await fetch('/api/ops/reasons')
    const j = await r.json().catch(() => ({}))
    if (r.ok) { setRows(j.reasons ?? []); setCanEdit(!!j.canEdit) } else setMsg(j.error || 'Accès réservé aux managers')
  }, [])
  useEffect(() => { void load() }, [load])

  const call = async (method: string, url: string, body?: unknown, ok = 'Enregistré.') => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const j = await r.json().catch(() => ({}))
    setMsg(r.ok ? (j.deactivated ? `Motif utilisé par ${j.used} commande(s) : désactivé au lieu d'être supprimé.` : ok) : (j.error || 'Échec'))
    if (r.ok) await load()
    return r.ok
  }
  const patch = (code: string, p: Partial<Reason>) => setRows(rs => rs.map(r => (r.code === code ? { ...r, ...p } : r)))
  const saveRow = (r: Reason) => call('PUT', '/api/ops/reasons', { code: r.code, label: r.label, labelAr: r.labelAr ?? '', kind: r.kind, cod: r.cod, rto: r.rto, sort: r.sort, active: r.active })
  const create = async () => { if (await call('POST', '/api/ops/reasons', draft, 'Motif créé.')) setDraft(EMPTY) }

  const input = 'w-full border border-gray-300 rounded-lg px-2 py-1 text-sm disabled:bg-gray-50'
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><ListChecks className="w-5 h-5 text-purple-600" />Motifs de non-livraison</h1>
        <p className="text-sm text-gray-500">Liste proposée au livreur quand une commande n&apos;est pas livrée (choix obligatoire). Le code est référencé par les commandes : il n&apos;est pas modifiable. « COD » = lié à l&apos;encaissement, « RTO » = déclenche un retour à l&apos;expéditeur.</p>
      </div>
      {msg && <div className="text-sm bg-purple-50 border border-purple-200 text-purple-800 rounded-lg p-3">{msg}</div>}
      {!canEdit && <div className="flex items-center gap-1 text-xs text-gray-500"><Lock className="w-3.5 h-3.5" />Lecture seule : le rôle Admin est requis pour modifier.</div>}

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="text-xs text-gray-500 bg-gray-50"><tr>
            <th className="p-2 text-left">Code</th><th className="p-2 text-left">Libellé FR</th><th className="p-2 text-left">Libellé AR</th><th className="p-2">COD</th><th className="p-2">RTO</th><th className="p-2">Ordre</th><th className="p-2">Actif</th><th className="p-2" />
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.code} className="border-t border-gray-100">
                <td className="p-2 font-mono text-xs">{r.code}</td>
                <td className="p-2"><input className={input} disabled={!canEdit} value={r.label} onChange={e => patch(r.code, { label: e.target.value })} /></td>
                <td className="p-2"><input className={input} dir="rtl" disabled={!canEdit} value={r.labelAr ?? ''} onChange={e => patch(r.code, { labelAr: e.target.value })} /></td>
                <td className="p-2 text-center"><input type="checkbox" disabled={!canEdit} checked={r.cod} onChange={e => patch(r.code, { cod: e.target.checked })} /></td>
                <td className="p-2 text-center"><input type="checkbox" disabled={!canEdit} checked={r.rto} onChange={e => patch(r.code, { rto: e.target.checked })} /></td>
                <td className="p-2"><input type="number" min={0} max={9999} className={`${input} w-20`} disabled={!canEdit} value={r.sort} onChange={e => patch(r.code, { sort: Number(e.target.value) })} /></td>
                <td className="p-2 text-center"><input type="checkbox" disabled={!canEdit} checked={r.active} onChange={e => patch(r.code, { active: e.target.checked })} /></td>
                <td className="p-2 whitespace-nowrap">
                  {canEdit && (
                    <>
                      <button onClick={() => void saveRow(r)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-purple-600 text-white mr-1"><Save className="w-3.5 h-3.5" />Enregistrer</button>
                      <button onClick={() => { if (window.confirm(`Supprimer le motif ${r.code} ? S'il est déjà utilisé, il sera seulement désactivé.`)) void call('DELETE', `/api/ops/reasons?code=${encodeURIComponent(r.code)}`, undefined, 'Motif supprimé.') }} className="inline-flex items-center px-2 py-1 text-xs rounded-lg bg-gray-100 text-red-600" aria-label="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-gray-400">Aucun motif.</td></tr>}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-800 mb-3">Nouveau motif</div>
          <div className="grid sm:grid-cols-4 gap-3">
            <label className="text-xs text-gray-600">Code (ex. COLIS_REFUSE)<input className={input} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })} /></label>
            <label className="text-xs text-gray-600">Libellé FR<input className={input} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></label>
            <label className="text-xs text-gray-600">Libellé AR<input className={input} dir="rtl" value={draft.labelAr ?? ''} onChange={e => setDraft({ ...draft, labelAr: e.target.value })} /></label>
            <label className="text-xs text-gray-600">Ordre<input type="number" min={0} max={9999} className={input} value={draft.sort} onChange={e => setDraft({ ...draft, sort: Number(e.target.value) })} /></label>
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-700">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.cod} onChange={e => setDraft({ ...draft, cod: e.target.checked })} />COD</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.rto} onChange={e => setDraft({ ...draft, rto: e.target.checked })} />RTO</label>
            <button onClick={() => void create()} className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-purple-600 text-white"><Plus className="w-4 h-4" />Ajouter</button>
          </div>
        </div>
      )}
    </div>
  )
}
