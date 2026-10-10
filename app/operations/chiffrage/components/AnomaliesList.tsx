'use client'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import { EST_BADGE, type Anomaly } from './types'

const SEV = {
  critical: { cls: 'border-red-200 bg-red-50', icon: <OctagonAlert className="w-4 h-4 text-red-600" />, label: 'Critique' },
  warn: { cls: 'border-amber-200 bg-amber-50', icon: <AlertTriangle className="w-4 h-4 text-amber-600" />, label: 'À surveiller' },
  info: { cls: 'border-gray-200 bg-gray-50', icon: <Info className="w-4 h-4 text-gray-500" />, label: 'Info' },
}

export default function AnomaliesList({ items }: { items: Anomaly[] | null }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-sm font-semibold text-gray-800 mb-3">Anomalies détectées {items && <span className="text-gray-400 font-normal">({items.length})</span>}</div>
      {!items && <div className="text-sm text-gray-400">Analyse en cours…</div>}
      {items && !items.length && <div className="text-sm text-gray-500">Aucune anomalie sur la période (ou données insuffisantes : km réels, pleins, tournées).</div>}
      <div className="space-y-2">
        {items?.map((a, i) => (
          <div key={i} className={`border rounded-lg p-3 ${SEV[a.severity].cls}`}>
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">{SEV[a.severity].icon}{a.title}<span className="text-[11px] text-gray-500 font-normal">{SEV[a.severity].label}</span>{a.estimated && <span className={EST_BADGE}>estimé</span>}</div>
            <div className="text-sm text-gray-700 mt-1">{a.detail}</div>
            <div className="text-sm text-gray-900 mt-1"><b>Recommandation :</b> {a.recommendation}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
