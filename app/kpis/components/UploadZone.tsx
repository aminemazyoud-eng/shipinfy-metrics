'use client'
import { useCallback, useState } from 'react'
import { Upload, Trash2, FileSpreadsheet, AlertCircle, CheckCircle2 } from 'lucide-react'

interface Report {
  id: string
  filename: string
  uploadedAt: string
  _count: { orders: number }
}

interface Props {
  activeReport: Report | null
  onUploadSuccess: (report: Report) => void
  onDeleteSuccess: () => void
}

type Phase = 'idle' | 'reading' | 'inserting' | 'done'

const MAX_FILE_SIZE_MB = 100
const BATCH_SIZE       = 1000  // rows per HTTP request — 1000 rows ≈ 1.2MB JSON, ~3-5s/batch
const CONCURRENCY      = 3     // batches sent in parallel — 9000 rows = 9 batches = 3 rounds ≈ 15s

// ─── Main component ────────────────────────────────────────────────────────────
export function UploadZone({ activeReport, onUploadSuccess, onDeleteSuccess }: Props) {
  const [uploading, setUploading] = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [dragOver,  setDragOver]  = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [phase,     setPhase]     = useState<Phase>('idle')
  const [progress,  setProgress]  = useState({ current: 0, total: 0 })

  // ── Core upload handler ──────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setError('Format non supporté. Utilisez un fichier .xlsx ou .xls')
      return
    }
    const sizeMB = file.size / (1024 * 1024)
    if (sizeMB > MAX_FILE_SIZE_MB) {
      setError(`Fichier trop volumineux (${sizeMB.toFixed(1)} Mo). Maximum: ${MAX_FILE_SIZE_MB} Mo.`)
      return
    }

    setError(null)
    setUploading(true)
    setPhase('reading')
    setProgress({ current: 0, total: 0 })

    try {
      // ── STEP 1 : Parse XLSX in the browser (no server timeout risk) ──────────
      const XLSX = await import('xlsx')
      const ab   = await file.arrayBuffer()
      const wb   = XLSX.read(new Uint8Array(ab), { type: 'array', cellDates: false })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows  = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

      if (rows.length === 0) {
        throw new Error('Le fichier ne contient aucune ligne de données.')
      }

      // ── STEP 2 : Create DeliveryReport (instant — no data, just metadata) ───
      const initRes = await fetch('/api/dashboard/upload/init', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filename: file.name }),
      })
      if (!initRes.ok) {
        const e = await initRes.json().catch(() => ({})) as { error?: string }
        throw new Error(e.error ?? 'Création du rapport échouée')
      }
      const { reportId, insertedAt } = await initRes.json() as {
        reportId: string; insertedAt: string
      }

      // ── STEP 3 : Send batches in parallel groups (CONCURRENCY at a time) ───
      setPhase('inserting')
      setProgress({ current: 0, total: rows.length })

      // Split all rows into BATCH_SIZE chunks
      const allBatches: Record<string, unknown>[][] = []
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        allBatches.push(rows.slice(i, i + BATCH_SIZE))
      }

      let inserted = 0

      // Send CONCURRENCY batches at the same time → much faster for large files
      for (let g = 0; g < allBatches.length; g += CONCURRENCY) {
        const group = allBatches.slice(g, g + CONCURRENCY)

        const results = await Promise.all(
          group.map(async (batch) => {
            const res = await fetch('/api/dashboard/upload/batch', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ reportId, rows: batch }),
            })
            if (!res.ok) {
              const e = await res.json().catch(() => ({})) as { error?: string }
              throw new Error(e.error ?? 'Erreur lors de l\'insertion des données')
            }
            return batch.length
          })
        )

        inserted += results.reduce((s, n) => s + n, 0)
        setProgress({ current: Math.min(inserted, rows.length), total: rows.length })
      }

      // ── STEP 4 : Done ────────────────────────────────────────────────────────
      setPhase('done')
      onUploadSuccess({
        id:       reportId,
        filename: file.name,
        uploadedAt: insertedAt,
        _count:   { orders: rows.length },
      })

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'import. Réessayez.')
      setPhase('idle')
    } finally {
      setUploading(false)
    }
  }, [onUploadSuccess])

  // ── Delete handler ───────────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!activeReport) return
    setDeleting(true)
    try {
      await fetch(`/api/dashboard/report/${activeReport.id}`, { method: 'DELETE' })
      onDeleteSuccess()
    } finally {
      setDeleting(false)
    }
  }, [activeReport, onDeleteSuccess])

  // ── Active report banner ─────────────────────────────────────────────────────
  if (activeReport) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-4">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-8 w-8 text-green-600" />
          <div>
            <p className="font-semibold text-green-900">{activeReport.filename}</p>
            <p className="text-sm text-green-700">
              {activeReport._count.orders.toLocaleString('fr-MA')} commandes · Importé le{' '}
              {new Date(activeReport.uploadedAt).toLocaleDateString('fr-MA')}
            </p>
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? 'Suppression...' : 'Supprimer et réimporter'}
        </button>
      </div>
    )
  }

  // ── Upload dropzone ──────────────────────────────────────────────────────────
  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0

  const totalBatches  = progress.total > 0 ? Math.ceil(progress.total / BATCH_SIZE) : 0
  const doneBatches   = progress.total > 0 ? Math.ceil(progress.current / BATCH_SIZE) : 0

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f) handleFile(f)
      }}
      className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
        dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'
      }`}
    >
      {/* ── Idle ── */}
      {!uploading && phase === 'idle' && (
        <>
          <Upload className="mx-auto mb-4 h-10 w-10 text-gray-400" />
          <p className="mb-2 text-lg font-semibold text-gray-700">Importer un fichier de tournées</p>
          <p className="mb-1 text-sm text-gray-500">
            Glissez votre fichier Excel ici ou cliquez pour sélectionner (.xlsx, .xls)
          </p>
          <p className="mb-4 text-xs text-gray-400">Taille maximale : {MAX_FILE_SIZE_MB} Mo</p>
        </>
      )}

      {/* ── Phase: Reading file ── */}
      {uploading && phase === 'reading' && (
        <>
          <div className="mb-4 flex items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          </div>
          <p className="mb-1 text-lg font-semibold text-gray-700">Lecture du fichier...</p>
          <p className="text-sm text-gray-500">Analyse du fichier Excel dans le navigateur</p>
        </>
      )}

      {/* ── Phase: Inserting batches ── */}
      {uploading && phase === 'inserting' && (
        <>
          <div className="mb-4 flex items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-green-200 border-t-green-600" />
          </div>
          <p className="mb-1 text-lg font-semibold text-gray-700">
            Import en cours — {doneBatches} / {totalBatches} lots
            <span className="ml-2 text-sm font-normal text-gray-400">({CONCURRENCY} en parallèle)</span>
          </p>
          <p className="mb-3 text-sm text-gray-500">
            {progress.current.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')} lignes insérées
          </p>
          {/* Real progress bar */}
          <div className="mx-auto w-72">
            <div className="mb-1.5 flex justify-between text-xs text-gray-400">
              <span>{pct}%</span>
              <span>{totalBatches} lots × {BATCH_SIZE} lignes</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Phase: Done ── */}
      {phase === 'done' && !uploading && (
        <>
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-500" />
          <p className="text-lg font-semibold text-green-700">Import terminé !</p>
          <p className="text-sm text-gray-500">
            {progress.total.toLocaleString('fr-FR')} lignes importées avec succès
          </p>
        </>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* ── File picker button ── */}
      {!uploading && phase !== 'done' && (
        <label className="mt-4 inline-block cursor-pointer rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
          Sélectionner un fichier
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
        </label>
      )}
    </div>
  )
}
