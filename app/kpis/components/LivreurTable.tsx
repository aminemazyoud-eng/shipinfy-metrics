'use client'
import { Trophy } from 'lucide-react'

interface Livreur {
  name: string
  rank: number
  total: number
  delivered: number
  noShow: number
  deliveryRate: number
  onTimeRate: number
  avgDuration: number
  totalCOD: number
}

function RateBadge({ rate }: { rate: number }) {
  const cls = rate >= 95 ? 'bg-green-100 text-green-800' : rate >= 85 ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{rate}%</span>
}

function fmtMin(min: number): string {
  if (min >= 60) return `${Math.round(min / 60 * 10) / 10}h`
  return `${min}min`
}

export function LivreurTable({ data }: { data: Livreur[] }) {
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="font-semibold text-gray-900">Classement Livreurs</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Rang','Livreur','Total','Livrées','NO_SHOW','Taux livraison','On-time','Durée moy.','Total COD'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map(l => (
              <tr key={l.name} className={l.rank === 1 ? 'bg-yellow-50' : 'hover:bg-gray-50'}>
                <td className="px-3 py-2 font-semibold text-gray-700">
                  {l.rank === 1 ? <Trophy className="inline h-4 w-4 text-yellow-500 mr-1" /> : null}#{l.rank}
                </td>
                <td className="px-3 py-2 font-medium text-gray-900">{l.name}</td>
                <td className="px-3 py-2">{l.total}</td>
                <td className="px-3 py-2 text-green-700 font-medium">{l.delivered}</td>
                <td className="px-3 py-2 text-red-600">{l.noShow}</td>
                <td className="px-3 py-2"><RateBadge rate={l.deliveryRate} /></td>
                <td className="px-3 py-2"><RateBadge rate={l.onTimeRate} /></td>
                <td className="px-3 py-2 text-gray-600">{fmtMin(l.avgDuration)}</td>
                <td className="px-3 py-2 font-medium">{l.totalCOD.toLocaleString('fr-MA')} MAD</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
