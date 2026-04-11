'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, Trash2, FileSpreadsheet, AlertCircle, CheckCircle2, Download } from 'lucide-react'

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
      setPhase('idle')
      onDeleteSuccess()
    } finally {
      setDeleting(false)
    }
  }, [activeReport, onDeleteSuccess])

  // ── Téléchargement du template Markdown ──────────────────────────────────
  const downloadTemplateMd = useCallback(() => {
    const md = `# Template d'import — Shipinfy Metrics
> Exportez ce fichier depuis Shopify/Mediflows puis importez-le sur /kpis.
> Le fichier doit être au format **.xlsx** ou **.xls**.

## Colonnes attendues

| Colonne Excel | Description |
|---|---|
| \`externalReference\` | Référence externe commande |
| \`shipperReference\` | Référence expéditeur |
| \`carrierReference\` | Référence transporteur |
| \`pickupTimeStart\` | Heure début pickup |
| \`deliveryTimeStart\` | Heure début créneau livraison |
| \`deliveryTimeEnd\` | Heure fin créneau livraison |
| \`dateTimeWhenOrderSent\` | Date/heure envoi commande |
| \`dateTimeWhenAssigned\` | Date/heure assignation livreur |
| \`dateTimeWhenInTransport\` | Date/heure prise en transport |
| \`dateTimeWhenStartDelivery\` | Date/heure début livraison |
| \`dateTimeWhenDelivrered\` | Date/heure livraison effective |
| \`dateTimeWhenNoShow\` | Date/heure no-show |
| \`dateTimeLastUpdate\` | Date/heure dernière mise à jour |
| \`shippingWorkflowStatus\` | Statut livraison (ex: Delivered, NoShow, ReadyForPickup) |
| \`paymentOnDeliveryAmount\` | Montant COD (paiement à la livraison) |
| \`destinationContactDetails.firstname\` | Prénom destinataire |
| \`destinationContactDetails.lastname\` | Nom destinataire |
| \`destinationCity.code\` | Code ville destination |
| \`destinationShippingAddress.longitude\` | Longitude adresse livraison |
| \`destinationShippingAddress.lattitude\` | Latitude adresse livraison |
| \`originHub.name\` | Nom du hub de départ |
| \`originHub.code\` | Code du hub de départ |
| \`originHub.city.name\` | Ville du hub de départ |
| \`originHub.address.longitude\` | Longitude hub |
| \`originHub.address.lattitude\` | Latitude hub |
| \`sprint.name\` | Nom de la tournée |
| \`sprint.businessUser.firstName\` | Prénom du livreur |
| \`sprint.businessUser.lastName\` | Nom du livreur |
| \`sprintGeoLocationLongitude\` | Longitude position livreur |
| \`sprintGeoLocationLattitude\` | Latitude position livreur |

## Remarques

- Les colonnes non reconnues sont **ignorées** — pas d'erreur.
- Les lignes entièrement vides sont **filtrées** automatiquement.
- Taille maximale : **100 Mo**. Nombre de lignes max recommandé : **200 000**.
- Les fichiers avec des millions de lignes vides (export Shopify brut) sont supportés.

## Statuts reconnus

| Valeur | Signification |
|---|---|
| \`Delivered\` | Livré |
| \`NoShow\` | Absent |
| \`ReadyForPickup\` | Prêt pour pickup |
| Autres | Statut personnalisé |
`
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'template-import-shipinfy.md'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

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

      {/* ── Étapes (uploading + processing) ── */}
      {(phase === 'uploading' || phase === 'processing') && (
        <div className="w-full">

          {/* Stepper */}
          <div className="mb-6 flex items-center justify-center gap-0">
            {/* Étape 1 */}
            <div className="flex flex-col items-center">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-all ${
                phase === 'uploading'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                  : 'bg-green-100 text-green-600'
              }`}>
                {phase === 'uploading' ? '1' : '✓'}
              </div>
              <p className={`mt-1 text-xs font-semibold ${phase === 'uploading' ? 'text-blue-600' : 'text-green-600'}`}>
                Envoi
              </p>
            </div>

            {/* Connecteur */}
            <div className="mx-2 mb-4 h-0.5 w-16 overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-all duration-700 ${phase === 'processing' ? 'bg-green-500 w-full' : 'bg-blue-400 w-1/2'}`}
              />
            </div>

            {/* Étape 2 */}
            <div className="flex flex-col items-center">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-all ${
                phase === 'processing'
                  ? 'bg-green-600 text-white shadow-md shadow-green-200'
                  : 'bg-gray-100 text-gray-400'
              }`}>
                2
              </div>
              <p className={`mt-1 text-xs font-semibold ${phase === 'processing' ? 'text-green-600' : 'text-gray-400'}`}>
                Import
              </p>
            </div>
          </div>

          {/* Étape 1 — Envoi */}
          {phase === 'uploading' && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-4">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-bold text-blue-700">Étape 1 — Envoi du fichier</p>
                <span className="text-sm font-bold text-blue-600">{uploadPct}%</span>
              </div>
              <p className="mb-3 text-xs text-blue-500">{uploadSize} en transfert vers le serveur...</p>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-blue-200">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${Math.max(2, uploadPct)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-blue-400">
                {uploadPct < 100 ? 'Le serveur analysera le fichier dès réception' : '✓ Fichier reçu — analyse en cours...'}
              </p>
            </div>
          )}

          {/* Étape 2 — Import */}
          {phase === 'processing' && (
            <div className="rounded-xl border border-green-100 bg-green-50 px-5 py-4">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-bold text-green-700">Étape 2 — Import en base de données</p>
                <span className="text-sm font-bold text-green-600">{pct}%</span>
              </div>
              <p className="mb-3 text-xs text-green-600">
                {progress.inserted.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')} lignes insérées
              </p>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-green-200">
                <div
                  className="h-full rounded-full bg-green-600 transition-all duration-500"
                  style={{ width: `${Math.max(4, pct)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-green-500">Les KPIs s&apos;afficheront automatiquement à la fin</p>
            </div>
          )}
        </div>
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

      {/* ── Sélecteur fichier + Template MD ── */}
      {phase === 'idle' && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Upload className="h-4 w-4" />
            Sélectionner un fichier
            <input
              type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </label>
          <button
            type="button"
            onClick={downloadTemplateMd}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Download className="h-4 w-4" />
            Télécharger le template
          </button>
        </div>
      )}
    </div>
  )
}
