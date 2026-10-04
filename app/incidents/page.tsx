'use client'
import { useEffect, useState } from 'react'
import { Bell, HeadphonesIcon, AlertTriangle } from 'lucide-react'
import AlertesPage from '../alertes/page'
import SupportPage from '../support/page'

type Tab = 'alertes' | 'support'

// Module unique « Incidents & Support » : alertes opérationnelles + tickets internes (ex /alertes)
// et réclamations clients (ex /support). Les anciennes adresses redirigent ici.
export default function IncidentsPage() {
  const [tab, setTab] = useState<Tab>('alertes')
  useEffect(() => { const t = new URLSearchParams(window.location.search).get('tab'); if (t === 'support' || t === 'alertes') setTab(t) }, [])
  const go = (t: Tab) => { setTab(t); window.history.replaceState(null, '', `/incidents?tab=${t}`) }

  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" />Incidents & Support</h1>
        <p className="text-sm text-gray-500">Un seul endroit pour les alertes terrain, les tickets internes et les réclamations clients. Les notifications se règlent dans Paramétrage → Notifications & incidents.</p>
        <div className="flex gap-1 border-b border-gray-200 mt-3">
          {([['alertes', 'Alertes & tickets internes', Bell], ['support', 'Réclamations clients', HeadphonesIcon]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => go(k)} className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-red-500 text-red-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}><I className="w-4 h-4" />{l}</button>
          ))}
        </div>
      </div>
      {tab === 'alertes' ? <AlertesPage /> : <SupportPage />}
    </div>
  )
}
