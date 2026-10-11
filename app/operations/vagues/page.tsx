'use client'
import { useEffect, useState } from 'react'
import { Layers, Package } from 'lucide-react'
import Lots from './Lots'
import Preparation from './Preparation'

type Tab = 'lots' | 'prep'

// Vagues : un seul module — « Lots (vagues) » (regroupement par secteur, impression, Excel) et « Préparation / picking » (ex /picking).
export default function VaguesPage() {
  const [tab, setTab] = useState<Tab>('lots')
  useEffect(() => { const t = new URLSearchParams(window.location.search).get('tab'); if (t === 'prep' || t === 'lots') setTab(t) }, [])
  const go = (t: Tab) => { setTab(t); window.history.replaceState(null, '', `/operations/vagues?tab=${t}`) }
  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6 print:hidden">
        <div className="flex gap-1 border-b border-gray-200">
          {([['lots', 'Lots (vagues)', Layers], ['prep', 'Préparation / picking', Package]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => go(k)} className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-purple-600 text-purple-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}><I className="w-4 h-4" />{l}</button>
          ))}
        </div>
      </div>
      {tab === 'lots' ? <Lots /> : <Preparation />}
    </div>
  )
}
