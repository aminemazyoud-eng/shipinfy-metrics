'use client'
import { useEffect, useState } from 'react'
import { Camera, MapPin, X, ExternalLink } from 'lucide-react'
import { geoBadge } from '@/lib/ops-proof-view'

interface Proof { id: string; kind: string; takenAt: string | null; createdAt: string; bytes: number; driverCode: string; lat: number | null; lng: number | null; accuracy: number | null }
export interface ProofGeo { lat: number | null; lng: number | null; distanceM: number | null; ok: boolean | null }

const KIND: Record<string, string> = { delivery: 'Livraison', noshow: 'NO_SHOW', damage: 'Dommage' }
const TONE = { green: 'bg-green-50 border-green-200 text-green-800', orange: 'bg-orange-50 border-orange-200 text-orange-800', gray: 'bg-gray-50 border-gray-200 text-gray-500' } as const
const hhmm = (d: string) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' })
const kb = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`)

/** Preuves de livraison d'une commande (photos) + bloc de géolocalisation. Images servies par /api/ops/proofs/:id (session requise). */
export default function ProofGallery({ orderId, geo, thresholdM = 300 }: { orderId: string; geo?: ProofGeo | null; thresholdM?: number }) {
  const [proofs, setProofs] = useState<Proof[] | null>(null)
  const [err, setErr] = useState(false)
  const [view, setView] = useState<Proof | null>(null)

  useEffect(() => {
    let alive = true
    setProofs(null); setErr(false)
    fetch(`/api/ops/orders/${orderId}/proofs`).then(r => (r.ok ? r.json() : Promise.reject())).then(j => alive && setProofs(j.proofs)).catch(() => alive && setErr(true))
    return () => { alive = false }
  }, [orderId])

  const badge = geoBadge(geo?.distanceM, geo?.ok, thresholdM)
  const hasPoint = geo?.lat != null && geo?.lng != null

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5"><Camera className="w-4 h-4 text-purple-600" />Preuves de livraison{proofs ? ` (${proofs.length})` : ''}</div>

      <div className={`mt-2 rounded-lg border px-2.5 py-1.5 text-sm flex flex-wrap items-center gap-x-2 gap-y-1 ${TONE[badge.tone]}`}>
        <MapPin className="w-4 h-4 shrink-0" /><span className="font-medium">{badge.label}</span>
        {geo?.distanceM != null && <span className="text-xs opacity-75">(seuil {thresholdM} m)</span>}
        {hasPoint && <a href={`https://www.google.com/maps?q=${geo!.lat},${geo!.lng}`} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs underline flex items-center gap-1">Point de livraison<ExternalLink className="w-3 h-3" /></a>}
      </div>

      {err && <div className="mt-2 text-xs text-amber-600">Preuves indisponibles (droits ou connexion).</div>}
      {proofs && !proofs.length && <div className="mt-2 text-xs text-gray-400">Aucune photo enregistrée pour cette commande.</div>}
      {proofs && proofs.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {proofs.map(p => (
            <button key={p.id} onClick={() => setView(p)} className="text-left rounded-lg border border-gray-200 overflow-hidden hover:border-purple-400">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/ops/proofs/${p.id}`} alt={`Preuve ${KIND[p.kind] ?? p.kind}`} loading="lazy" className="w-full h-20 object-cover bg-gray-100" />
              <div className="px-1.5 py-1 text-[10px] text-gray-500 leading-tight">{KIND[p.kind] ?? p.kind}<br />{hhmm(p.takenAt ?? p.createdAt)}</div>
            </button>
          ))}
        </div>
      )}

      {view && (
        <div className="fixed inset-0 bg-black/85 z-[60] flex flex-col items-center justify-center p-4" onClick={() => setView(null)}>
          <button onClick={() => setView(null)} className="absolute top-4 right-4 text-white" aria-label="Fermer"><X className="w-6 h-6" /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/ops/proofs/${view.id}`} alt="Preuve de livraison" onClick={e => e.stopPropagation()} className="max-h-[80vh] max-w-full object-contain rounded" />
          <div className="mt-3 text-sm text-white/90 text-center" onClick={e => e.stopPropagation()}>
            {KIND[view.kind] ?? view.kind} · {hhmm(view.takenAt ?? view.createdAt)} · livreur {view.driverCode} · {kb(view.bytes)}
            <div className="text-xs text-white/70">{view.accuracy != null ? `précision GPS ±${Math.round(view.accuracy)} m` : 'précision GPS inconnue'}
              {view.lat != null && view.lng != null && <> · <a href={`https://www.google.com/maps?q=${view.lat},${view.lng}`} target="_blank" rel="noopener noreferrer" className="underline">lieu de la photo</a></>}</div>
          </div>
        </div>
      )}
    </div>
  )
}
