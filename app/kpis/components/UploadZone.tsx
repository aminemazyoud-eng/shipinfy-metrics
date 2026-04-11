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

const MAX_FILE_SIZE_MB = 100
const POLL_INTERVAL_MS = 1500

export function UploadZone({ activeReport, onUploadSuccess, onDeleteSuccess }: Props) {
  const [phase,      setPhase]      = useState<Phase>('idle')
  const [deleting,   setDeleting]   = useState(false)
  const [dragOver,   setDragOver]   = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [progress,   setProgress]   = useState({ inserted: 0, total: 0 })
  const [uploadPct,  setUploadPct]  = useState(0)   // 0-100 — file bytes sent
  const [uploadSize, setUploadSize] = useState('')  // e.g. "5.7 Mo"

  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const xhrRef    = useRef<XMLHttpRequest | null>(null)
  const reportRef = useRef<{ id: string; filename: string; insertedAt: string; total: number } | null>(null)

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  useEffect(() => () => {
    stopPoll()
    xhrRef.current?.abort()
  }, [stopPoll])

  // ── Polling après que le serveur accepte l'upload ─────────────────────────
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
            id:         r.id,
            filename:   r.filename,
            uploadedAt: r.insertedAt,
            _count:     { orders: data.total || totalRows },
          })
        }
      } catch {
        // Réseau instable — on continue
      }
    }, POLL_INTERVAL_MS)
  }, [stopPoll, onUploadSuccess])

  // ── Envoi du fichier via XHR (avec progression) ───────────────────────────
  const handleFile = useCallback((file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setError('Format non supporté. Utilisez un fichier .xlsx ou .xls')
      return
    }
    const sizeMB = file.size / (1024 * 1024)
    if (sizeMB > MAX_FILE_SIZE_MB) {
      setError(`Fichier trop volumineux (${sizeMB.toFixed(1)} Mo). Maximum : ${MAX_FILE_SIZE_MB} Mo.`)
      return
    }

    setError(null)
    setPhase('uploading')
    setUploadPct(0)
    setUploadSize(`${sizeMB.toFixed(1)} Mo`)
    setProgress({ inserted: 0, total: 0 })

    const fd = new FormData()
    fd.append('file', file)

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr

    // Progression du transfert fichier → serveur
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadPct(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      xhrRef.current = null
      if (xhr.status < 200 || xhr.status >= 300) {
        let msg = 'Upload échoué'
        try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg } catch { /* */ }
        setError(msg)
        setPhase('idle')
        return
      }

      let data: { reportId: string; filename: string; totalRows: number; insertedAt: string }
      try { data = JSON.parse(xhr.responseText) } catch {
        setError('Réponse serveur invalide. Réessayez.')
        setPhase('idle')
        return
      }

      reportRef.current = {
        id:         data.reportId,
        filename:   data.filename,
        insertedAt: data.insertedAt,
        total:      data.totalRows,
      }

      setPhase('processing')
      setProgress({ inserted: 0, total: data.totalRows })
      startPolling(data.reportId, data.totalRows)
    }

    xhr.onerror = () => {
      xhrRef.current = null
      setError('Erreur réseau. Vérifiez votre connexion et réessayez.')
      setPhase('idle')
    }

    xhr.ontimeout = () => {
      xhrRef.current = null
      setError('Délai dépassé. Le fichier est peut-être trop volumineux pour votre connexion.')
      setPhase('idle')
    }

    // 5 minutes max — permet l'envoi de gros fichiers sur connexions lentes
    xhr.timeout = 300_000
    xhr.open('POST', '/api/dashboard/upload')
    xhr.send(fd)
  }, [startPolling])

  // ── Suppression du rapport actif ─────────────────────────────────────────
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

  // ── Bandeau rapport actif ─────────────────────────────────────────────────
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

      {/* ── Uploading — progression réelle de l'envoi ── */}
      {phase === 'uploading' && (
        <>
          <div className="mb-4 flex items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          </div>
          <p className="mb-1 text-lg font-semibold text-gray-700">
            Envoi du fichier — {uploadPct}%
          </p>
          <p className="mb-3 text-sm text-gray-500">
            {uploadSize} en cours de transfert vers le serveur...
          </p>
          <div className="mx-auto w-72">
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${Math.max(2, uploadPct)}%` }}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {uploadPct < 100
              ? 'Le serveur analysera le fichier dès réception complète'
              : 'Fichier reçu — analyse en cours...'}
          </p>
        </>
      )}

      {/* ── Processing — insertion en base ── */}
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

      {/* ── Erreur ── */}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* ── Sélecteur fichier ── */}
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
