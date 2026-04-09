'use client'

interface Hub {
  hubName: string
  hubCity: string
  total: number
  delivered: number
  deliveryRate: number
  avgDuration: number
  totalCOD: number
}

function fmtMin(min: number): string {
  if (min >= 60) return `${Math.round(min / 60 * 10) / 10}h`
  return `${min}min`
}

export function HubTable({ data }: { data: Hub[] }) {
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="font-semibold text-gray-900">Performance par Hub</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Hub','Ville','Total','Livrées','Taux livraison','Durée moy.','Total COD'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map((h, i) => (
              <tr key={h.hubName} className={i === 0 ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                <td className="px-3 py-2 font-medium text-gray-900">
                  {i === 0 && <span className="mr-1">🏆</span>}{h.hubName}
                </td>
                <td className="px-3 py-2 text-gray-600">{h.hubCity}</td>
                <td className="px-3 py-2">{h.total}</td>
                <td className="px-3 py-2 text-green-700 font-medium">{h.delivered}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${h.deliveryRate >= 95 ? 'bg-green-100 text-green-800' : h.deliveryRate >= 85 ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}`}>
                    {h.deliveryRate}%
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600">{fmtMin(h.avgDuration)}</td>
                <td className="px-3 py-2 font-medium">{h.totalCOD.toLocaleString('fr-MA')} MAD</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
