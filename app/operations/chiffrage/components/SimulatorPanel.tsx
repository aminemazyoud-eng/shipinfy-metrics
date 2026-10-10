'use client'
import { useEffect, useState } from 'react'
import { mad, STATUS_CLS, EST_BADGE, type Status } from './types'

interface Sim { costPerOrder: number | null; ordersPerDay: number; kmPerDay: number; cost: { total: number }; margin: number | null; marginPerOrder: number | null; breakEvenOrdersPerDay: number | null; breakEvenOrdersPerRotation: number | null; gapVsMax: number | null; status: Status; dayCostGap: number; inTarget: boolean }
interface Out { scenario: Sim; withHelper: Sim; withoutHelper: Sim; sweep: { ordersPerRotation: number; costPerOrder: number | null; margin: number | null }[]; recommendations: string[]; targets: { costMin: number; costMax: number } }

// Simulateur : curseurs → POST /api/ops/costing/simulate (calcul pur, rien n'est enregistré). Tout est « estimé ».
export default function SimulatorPanel() {
  const [v, setV] = useState({ ordersPerRotation: 3.5, rotationsPerDay: 8, helper: true, fuelPrice: 11.4, kmPerOrder: 6 })
  const [price, setPrice] = useState('')
  const [out, setOut] = useState<Out | null>(null)
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await fetch('/api/ops/costing/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...v, ...(price.trim() && Number(price.replace(',', '.')) > 0 ? { price: Number(price.replace(',', '.')) } : {}) }) })
      if (r.ok) setOut(await r.json())
    }, 200)
    return () => clearTimeout(t)
  }, [v, price])
  const slider = (label: string, k: 'ordersPerRotation' | 'rotationsPerDay' | 'fuelPrice' | 'kmPerOrder', min: number, max: number, step: number) => (
    <label className="text-xs text-gray-500 block">{label} : <b className="text-gray-900">{v[k]}</b>
      <input type="range" min={min} max={max} step={step} value={v[k]} onChange={e => setV(s => ({ ...s, [k]: Number(e.target.value) }))} className="block w-full accent-purple-600" /></label>
  )
  const s = out?.scenario
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
      <div className="text-sm font-semibold text-gray-800">Simulateur d&apos;optimisation <span className={EST_BADGE}>estimé</span></div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {slider('Commandes / rotation', 'ordersPerRotation', 1, 8, 0.25)}
        {slider('Rotations / jour', 'rotationsPerDay', 1, 12, 1)}
        {slider('Prix du gasoil (MAD/L)', 'fuelPrice', 8, 18, 0.1)}
        {slider('Km / commande', 'kmPerOrder', 1, 25, 0.5)}
        <label className="text-xs text-gray-500 flex items-center gap-2 pt-4"><input type="checkbox" checked={v.helper} onChange={e => setV(x => ({ ...x, helper: e.target.checked }))} className="accent-purple-600" />Helper dans l&apos;équipe</label>
        <label className="text-xs text-gray-500">Prix facturé / commande (MAD, optionnel)<input value={price} onChange={e => setPrice(e.target.value)} placeholder="paramètre par défaut" inputMode="decimal" className="block w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900" /></label>
      </div>
      {s && out && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border border-gray-200 rounded-lg p-2.5"><div className="text-xs text-gray-500">Coût / commande</div><div className="text-lg font-bold"><span className={`px-1.5 rounded ${STATUS_CLS[s.status]}`}>{mad(s.costPerOrder)}</span></div><div className="text-[11px] text-gray-500">cible {out.targets.costMin}–{out.targets.costMax}</div></div>
            <div className="border border-gray-200 rounded-lg p-2.5"><div className="text-xs text-gray-500">Coût de la journée</div><div className="text-lg font-bold">{mad(s.cost.total, 0)}</div><div className="text-[11px] text-gray-500">{s.ordersPerDay} cmd · {s.kmPerDay} km</div></div>
            <div className="border border-gray-200 rounded-lg p-2.5"><div className="text-xs text-gray-500">Marge / jour</div><div className={`text-lg font-bold ${s.margin == null ? 'text-gray-400' : s.margin >= 0 ? 'text-green-700' : 'text-red-700'}`}>{s.margin == null ? 'n/d' : mad(s.margin, 0)}</div></div>
            <div className="border border-gray-200 rounded-lg p-2.5"><div className="text-xs text-gray-500">Seuil de rentabilité</div><div className="text-lg font-bold">{s.breakEvenOrdersPerDay == null ? 'n/d' : `${s.breakEvenOrdersPerDay} cmd/j`}</div><div className="text-[11px] text-gray-500">{s.breakEvenOrdersPerRotation != null ? `≈ ${s.breakEvenOrdersPerRotation} / rotation` : ''}</div></div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">Coût / commande selon la densité de rotation</div>
              <table className="text-sm w-full"><tbody>
                {out.sweep.map(w => <tr key={w.ordersPerRotation} className={`border-t border-gray-100 ${w.ordersPerRotation === v.ordersPerRotation ? 'font-semibold' : ''}`}><td className="py-1">{w.ordersPerRotation} cmd/rotation</td><td className="text-right">{mad(w.costPerOrder)}</td><td className="text-right text-gray-500">{w.margin == null ? '' : mad(w.margin, 0)}</td></tr>)}
              </tbody></table>
              <div className="text-xs text-gray-500 mt-2">Avec helper : <b>{mad(out.withHelper.costPerOrder)}</b> · Sans helper : <b>{mad(out.withoutHelper.costPerOrder)}</b></div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">Recommandations</div>
              <ul className="list-disc pl-4 space-y-1 text-sm text-gray-700">{out.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
