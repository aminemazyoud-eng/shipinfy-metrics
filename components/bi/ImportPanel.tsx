'use client'
// Scénario B : alimenter le Dashboard par un FICHIER D'EXPORT (CSV / Excel) au lieu de l'API du back-office.
// Deux étapes : 1) « Vérifier » (analyse sans rien enregistrer) 2) « Importer ». Les commandes sont rangées sous la source « Import fichier ».
import { useRef, useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Trash2, Upload, X, XCircle } from 'lucide-react'
import { EXPORT_COLUMNS, templateCsv } from '@/lib/ops-import'

interface Summary {
  dryRun: boolean; fileName: string; rows: number; unique: number; duplicates: number; rejected: number
  rejectedSample: { line: number; reference: string | null; reason: string }[]
  period: { from: string; to: string } | null; statuses: Record<string, number>; unknownStatuses: string[]; hubs: string[]
  inserted?: number; replaced?: number
}

const nf = new Intl.NumberFormat('fr-FR')
const fr = (d: string) => d.split('-').reverse().join('/')

export default function ImportPanel({ canPurge, hasImport, onClose, onImported }: { canPurge: boolean; hasImport: boolean; onClose: () => void; onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<'check' | 'import' | 'purge' | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function send(dryRun: boolean) {
    if (!file) return
    setBusy(dryRun ? 'check' : 'import'); setError(null); if (dryRun) { setSummary(null); setDone(null) }
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch(`/api/ops/import${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error ?? `Erreur ${r.status}`); return }
      setSummary(j as Summary)
      if (!dryRun) { setDone(`Import terminé : ${nf.format(j.inserted)} nouvelle(s) commande(s), ${nf.format(j.replaced)} mise(s) à jour.`); onImported() }
    } catch { setError('Envoi impossible : vérifiez votre connexion.') } finally { setBusy(null) }
  }

  async function purge() {
    if (!window.confirm('Supprimer TOUTES les commandes importées par fichier ?\nLes données de l’API du back-office ne sont pas touchées. Cette action est irréversible.')) return
    setBusy('purge'); setError(null)
    try {
      const r = await fetch('/api/ops/import', { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error ?? `Erreur ${r.status}`); return }
      setSummary(null); setFile(null); setDone(`${nf.format(j.orders)} commande(s) importée(s) supprimée(s).`); onImported()
    } finally { setBusy(null) }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'modele-import-shipinfy.csv'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm print:hidden">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900"><FileSpreadsheet className="h-4 w-4 text-blue-600" /> Importer un fichier d’export</h2>
          <p className="mt-0.5 text-xs text-gray-500">Export Shipinfy au format <b>.csv</b> ou <b>.xlsx</b> (10 Mo maximum). Une commande déjà importée est mise à jour ; l’API du back-office n’est jamais modifiée.</p>
        </div>
        <button onClick={onClose} aria-label="Fermer" className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept=".csv,.xlsx" className="hidden" onChange={e => { setFile(e.target.files?.[0] ?? null); setSummary(null); setError(null); setDone(null) }} />
        <button onClick={() => input.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"><Upload className="h-3.5 w-3.5" /> Choisir un fichier</button>
        <span className="text-xs text-gray-500">{file ? `${file.name} · ${nf.format(Math.round(file.size / 1024))} Ko` : 'Aucun fichier choisi'}</span>
        <button onClick={() => send(true)} disabled={!file || !!busy} className="ml-auto flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-900 disabled:opacity-40">
          {busy === 'check' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Vérifier le fichier
        </button>
        <button onClick={() => send(false)} disabled={!summary || !summary.dryRun || !!busy} className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-40">
          {busy === 'import' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Importer
        </button>
      </div>

      {error && <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /><span>{error}</span></div>}
      {done && <div className="mt-3 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /><span>{done}</span></div>}

      {summary && (
        <div className="mt-3 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-700">
          <p><b>{nf.format(summary.unique)}</b> commande(s) exploitable(s) sur {nf.format(summary.rows)} ligne(s){summary.duplicates ? ` (${nf.format(summary.duplicates)} doublon(s) regroupé(s), la version la plus récente est gardée)` : ''}
            {summary.period && <> · période du <b>{fr(summary.period.from)}</b> au <b>{fr(summary.period.to)}</b></>} · {summary.hubs.length} magasin(s)</p>
          <p className="flex flex-wrap gap-1.5">{Object.entries(summary.statuses).sort((a, b) => b[1] - a[1]).map(([s, c]) => <span key={s} className={`rounded-full px-2 py-0.5 ${s === 'DELIVERED' ? 'bg-green-100 text-green-800' : 'bg-white text-gray-600 ring-1 ring-gray-200'}`}>{s} {nf.format(c)}</span>)}</p>
          {summary.unknownStatuses.length > 0 && <p className="text-amber-700">Statuts inhabituels (importés tels quels) : {summary.unknownStatuses.join(', ')}.</p>}
          {summary.rejected > 0 && (
            <div className="text-amber-700">
              <p>{nf.format(summary.rejected)} ligne(s) ignorée(s) :</p>
              <ul className="list-disc pl-5">{summary.rejectedSample.map(r => <li key={r.line}>ligne {r.line}{r.reference ? ` (${r.reference})` : ''} — {r.reason}</li>)}{summary.rejected > summary.rejectedSample.length && <li>…</li>}</ul>
            </div>
          )}
          {summary.dryRun ? <p className="font-medium text-blue-700">Vérification faite, rien n’est encore enregistré : cliquez sur « Importer » pour valider.</p> : null}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3 text-[11px] text-gray-500">
        <button onClick={downloadTemplate} className="flex items-center gap-1 text-blue-600 hover:underline"><Download className="h-3 w-3" /> Télécharger le modèle (CSV)</button>
        <span title={EXPORT_COLUMNS.join(', ')}>{EXPORT_COLUMNS.length} colonnes attendues (survolez pour la liste)</span>
        {canPurge && hasImport && (
          <button onClick={purge} disabled={!!busy} className="ml-auto flex items-center gap-1 text-red-600 hover:underline disabled:opacity-40"><Trash2 className="h-3 w-3" /> Supprimer les données importées</button>
        )}
      </div>
    </div>
  )
}
