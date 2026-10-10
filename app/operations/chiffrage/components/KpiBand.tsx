'use client'
import { mad, STATUS_CLS, EST_BADGE, type CostingRes } from './types'

// Bandeau KPI : coût/commande (coloré vs cible), marge, commandes, km. Les valeurs estimées portent le badge « estimé ».
export default function KpiBand({ data }: { data: CostingRes | null }) {
  const s = data?.summary, t = data?.targets
  const est = s?.estimated ? <span className={EST_BADGE} title={`Part estimée du coût : ${s.estimatedCostPct} % (${s.estimatedParts.join(', ')})`}>estimé</span> : null
  const card = (label: string, value: string, sub?: string, cls = 'text-gray-900', extra?: React.ReactNode) => (
    <div className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">{label}</div><div className={`text-xl font-bold ${cls}`}>{value}{extra}</div>{sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}</div>
  )
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {card('Coût par commande', s ? mad(s.costPerOrder) : '…', t ? `cible ${t.costMin.toFixed(2)}–${t.costMax.toFixed(2)} MAD${s?.gapVsMax != null ? ` · écart ${s.gapVsMax > 0 ? '+' : ''}${s.gapVsMax.toFixed(2)}` : ''}` : undefined, s ? STATUS_CLS[s.status].split(' ')[0] : '', est)}
      {card('Coût véhicule-jour', s ? mad(s.avgDayCost, 0) : '…', t ? `cible ${t.vehicleDayCost} MAD${s?.dayCostGap != null ? ` · écart ${s.dayCostGap > 0 ? '+' : ''}${Math.round(s.dayCostGap)}` : ''}` : undefined, 'text-gray-900', est)}
      {card('Marge', s ? (s.margin == null ? 'n/d' : mad(s.margin, 0)) : '…', s?.margin == null ? 'prix facturé non renseigné (Paramètres)' : `${mad(s.marginPerOrder)} / commande`, s?.margin != null ? (s.margin >= 0 ? 'text-green-700' : 'text-red-700') : 'text-gray-400', est)}
      {card('Commandes livrées', s ? s.orders.toLocaleString('fr-FR') : '…', s ? `${s.teamDays} journées-équipe` : undefined)}
      {card('Rotations / jour', s?.avgRotations != null ? String(s.avgRotations) : 'n/d', t ? `cible ${t.rotationsPerDay} · ${s?.avgOrdersPerRotation ?? 'n/d'} cmd/rotation` : undefined)}
      {card('Kilomètres', s ? Math.round(s.km).toLocaleString('fr-FR') + ' km' : '…', s?.avgKmPerOrder != null ? `${s.avgKmPerOrder} km / commande` : undefined)}
    </div>
  )
}
