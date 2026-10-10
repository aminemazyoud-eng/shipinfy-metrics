'use client'
import { mad, STATUS_CLS, EST_BADGE, type CostingRes } from './types'

const COLS = [['driver', 'Chauffeur'], ['helper', 'Helper'], ['charges', 'Charges'], ['fuel', 'Carburant'], ['maintenance', 'Entretien'], ['vehicle', 'Véhicule'], ['equipment', 'SI']] as const

// Tableau par dimension : écart coloré vs la cible haute (vert ≤ cible · ambre ≤ +10 % · rouge au-delà).
export default function DimensionTable({ data, dimLabel }: { data: CostingRes | null; dimLabel: string }) {
  const s = data?.summary
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200">
          {[dimLabel, 'Cmd', 'Équipes-jours', 'Km', 'Coût total', 'Coût / cmd', 'Écart vs cible', ...COLS.map(c => c[1]), 'Revenu', 'Marge'].map(h => <th key={h} className="p-2 font-medium whitespace-nowrap first:pl-3">{h}</th>)}
        </tr></thead>
        <tbody>
          {data?.rows.map(r => (
            <tr key={r.key} className="border-t border-gray-100">
              <td className="p-2 pl-3 whitespace-nowrap font-medium text-gray-800">{r.label}{r.estimated && <span className={EST_BADGE} title={`${r.estimatedCostPct} % du coût est estimé`}>estimé {r.estimatedCostPct < 100 ? `${Math.round(r.estimatedCostPct)} %` : ''}</span>}</td>
              <td className="p-2 text-right">{r.orders}</td><td className="p-2 text-right text-gray-500">{r.teamDays}</td><td className="p-2 text-right text-gray-500">{Math.round(r.km)}</td>
              <td className="p-2 text-right whitespace-nowrap">{mad(r.cost, 0)}</td>
              <td className="p-2 text-right whitespace-nowrap font-semibold">{mad(r.costPerOrder)}</td>
              <td className="p-2 text-right whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_CLS[r.status]}`}>{r.gapVsMax == null ? 'n/d' : `${r.gapVsMax > 0 ? '+' : ''}${r.gapVsMax.toFixed(2)} (${r.gapPct != null ? (r.gapPct > 0 ? '+' : '') + r.gapPct : '—'} %)`}</span></td>
              {COLS.map(c => <td key={c[0]} className="p-2 text-right text-gray-600 whitespace-nowrap">{Math.round(r.breakdown[c[0]])}</td>)}
              <td className="p-2 text-right whitespace-nowrap">{r.revenue ? mad(r.revenue, 0) : '—'}</td>
              <td className={`p-2 text-right whitespace-nowrap ${r.margin == null ? 'text-gray-400' : r.margin >= 0 ? 'text-green-700' : 'text-red-700'}`}>{r.margin == null ? 'n/d' : mad(r.margin, 0)}</td>
            </tr>
          ))}
          {s && data && data.rows.length > 0 && (
            <tr className="border-t-2 border-gray-300 font-semibold bg-gray-50">
              <td className="p-2 pl-3">Total</td><td className="p-2 text-right">{s.orders}</td><td className="p-2 text-right">{s.teamDays}</td><td className="p-2 text-right">{Math.round(s.km)}</td>
              <td className="p-2 text-right whitespace-nowrap">{mad(s.cost, 0)}</td><td className="p-2 text-right whitespace-nowrap">{mad(s.costPerOrder)}</td>
              <td className="p-2 text-right"><span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_CLS[s.status]}`}>{s.gapVsMax == null ? 'n/d' : `${s.gapVsMax > 0 ? '+' : ''}${s.gapVsMax.toFixed(2)}`}</span></td>
              {COLS.map(c => <td key={c[0]} className="p-2 text-right">{Math.round(s.breakdown[c[0]])}</td>)}
              <td className="p-2 text-right">{s.revenue ? mad(s.revenue, 0) : '—'}</td><td className="p-2 text-right">{s.margin == null ? 'n/d' : mad(s.margin, 0)}</td>
            </tr>
          )}
          {data && !data.rows.length && <tr><td colSpan={16} className="p-8 text-center text-gray-400">Aucune livraison sur cette période</td></tr>}
          {!data && <tr><td colSpan={16} className="p-8 text-center text-gray-400">Chargement…</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
