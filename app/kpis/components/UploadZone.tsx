'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
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

type Phase = 'idle' | 'uploading' | 'processing' | 'done'

const MAX_FILE_SIZE_MB  = 100
const POLL_INTERVAL_MS  = 1500   // poll status every 1.5s

export function UploadZone({ activeReport, onUploadSuccess, onDeleteSuccess }: Props) {
  const [phase,     setPhase]     = useState<Phase>('idle')
  const [deleting,  setDeleting]  = useState(false)
  const [dragOver,  setDragOver]  = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [progress,  setProgress]  = useState({ inserted: 0, total: 0 })

  // Polling refs
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const reportRef   = useRef<{ id: string; filename: string; insertedAt: string; total: number } | null>(null)

  // ── Stop polling ─────────────────────────────────────────────────────────────
  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // Cleanup on unmount
  useEffect(() => () => stopPoll(), [stopPoll])

  // ── Start polling after server accepts upload ─────────────────────────────────
  const startPolling = useCallback((reportId: string, totalRows: number) => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`/api/dashboard/upload/status/${reportId}`)
        const data = await res.json() as { total: number; inserted: number; done: boolean; error?: string }

        setProgress({ inserted: data.inserted, total: data.total || totalRows })

        if (data.error) {
          stopPoll()
          setError(`Erreur d'insertion : ${data.error}`)
          setPhase('idle')
          return
        }

        if (data.done) {
          stopPoll()
          setPhase('done')
          const r = reportRef.current!
          onUploadSuccess({
            id:          r.id,
            filename:    r.filename,
            uploadedAt:  r.insertedAt,
            _count:      { orders: data.total || totalRows },
          })
        }
      } catch {
        // Network hiccup — keep polling
      }
    }, POLL_INTERVAL_MS)
  }, [stopPoll, onUploadSuccess])

  // ── File handler ─────────────────────────────────────────────────────────────
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
    setPhase('uploading')
    setProgress({ inserted: 0, total: 0 })

    // Abort if server doesn't respond within 55s (before Traefik's ~60s timeout)
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), 55_000)

    try {
      const fd = new FormData()
      fd.append('file', file)

      // Server parses XLSX and returns in <3s — then processes in background
      const res = await fetch('/api/dashboard/upload', {
        method: 'POST',
        body: fd,
        signal: controller.signal,
      })
      clearTimeout(abortTimer)

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Upload échoué')
      }

      const data = await res.json() as {
        reportId: string; filename: string; totalRows: number; insertedAt: string
      }

      // Store for later use when polling completes
      reportRef.current = {
        id:         data.reportId,
        filename:   data.filename,
        insertedAt: data.insertedAt,
        total:      data.totalRows,
      }

      setPhase('processing')
      setProgress({ inserted: 0, total: data.totalRows })

      // Start polling status endpoint
      startPolling(data.reportId, data.totalRows)

    } catch (err: unknown) {
      clearTimeout(abortTimer)
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Délai dépassé. Le serveur met trop de temps à répondre — réessayez dans quelques secondes.')
      } else {
        setError(err instanceof Error ? err.message : 'Erreur lors de l\'import. Réessayez.')
      }
      setPhase('idle')
    }
  }, [startPolling])

  // ── Delete handler ────────────────────────────────────────────────────────────
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

  // ── Active report banner ──────────────────────────────────────────────────────
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

  // ── Progress percentage ───────────────────────────────────────────────────────
  const pct = progress.total > 0 ? Math.round((progress.inserted / progress.total) * 100) : 0

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault(); setDragOver(false)
        const f = e.dataTransfer.files[0]; if (f) handleFile(f)
      }}
      className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
        dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'
      }`}
    >

      {/* ── Idle ── */}
      {phase === 'idle' && (
        <>
          <Upload className="mx-auto mb-4 h-10 w-10 text-gray-400" />
          <p className="mb-2 text-lg font-semibold text-gray-700">Importer un fichier de tournées</p>
          <p className="mb-1 text-sm text-gray-500">Glissez votre fichier Excel ici ou cliquez (.xlsx, .xls)</p>
          <p className="mb-4 text-xs text-gray-400">Taille maximale : {MAX_FILE_SIZE_MB} Mo</p>
        </>
      )}

      {/* ── Uploading (sending file to server) ── */}
      {phase === 'uploading' && (
        <>
          <div className="mb-4 flex items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          </div>
          <p className="mb-1 text-lg font-semibold text-gray-700">Envoi du fichier...</p>
          <p className="text-sm text-gray-500">Analyse en cours, patientez quelques secondes</p>
        </>
      )}

      {/* ── Processing (background insertion, real progress bar) ── */}
      {phase === 'processing' && (
        <>
          <div className="mb-4 flex items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-green-200 border-t-green-600" />
          </div>
          <p className="mb-1 text-lg font-semibold text-gray-700">
            Import en cours — {pct}%
          </p>
          <p className="mb-3 text-sm text-gray-500">
            {progress.inserted.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')} lignes insérées
          </p>
          <div className="mx-auto w-72">
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-500"
                style={{ width: `${Math.max(4, pct)}%` }}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">Les KPIs s&apos;afficheront automatiquement à la fin</p>
        </>
      )}

      {/* ── Done ── */}
      {phase === 'done' && (
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

      {/* ── File picker ── */}
      {phase === 'idle' && (
        <label className="mt-4 inline-block cursor-pointer rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
          Sélectionner un fichier
          <input
            type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </label>
      )}
    </div>
  )
}
