'use client'
import { useCallback, useState } from 'react'
import { Upload, Trash2, FileSpreadsheet } from 'lucide-react'

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

export function UploadZone({ activeReport, onUploadSuccess, onDeleteSuccess }: Props) {
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setError('Format non supporté. Utilisez un fichier .xlsx ou .xls')
      return
    }
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/dashboard/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error('Upload échoué')
      const data = await res.json() as { reportId: string; filename: string; totalRows: number; insertedAt: string }
      onUploadSuccess({ id: data.reportId, filename: data.filename, uploadedAt: data.insertedAt, _count: { orders: data.totalRows } })
    } catch {
      setError('Erreur lors de l\'import. Réessayez.')
    } finally {
      setUploading(false)
    }
  }, [onUploadSuccess])

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

  if (activeReport) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-4">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-8 w-8 text-green-600" />
          <div>
            <p className="font-semibold text-green-900">{activeReport.filename}</p>
            <p className="text-sm text-green-700">
              {activeReport._count.orders} commandes · Importé le {new Date(activeReport.uploadedAt).toLocaleDateString('fr-MA')}
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

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
      className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}
    >
      <Upload className="mx-auto mb-4 h-10 w-10 text-gray-400" />
      <p className="mb-2 text-lg font-semibold text-gray-700">
        {uploading ? 'Import en cours...' : 'Importer un fichier de tournées'}
      </p>
      <p className="mb-4 text-sm text-gray-500">Glissez votre fichier Excel ici ou cliquez pour sélectionner (.xlsx, .xls)</p>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!uploading && (
        <label className="cursor-pointer rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
          Sélectionner un fichier
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </label>
      )}
      {uploading && (
        <div className="mx-auto h-2 w-64 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full w-full animate-pulse rounded-full bg-blue-500" />
        </div>
      )}
    </div>
  )
}
