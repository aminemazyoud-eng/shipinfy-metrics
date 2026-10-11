'use client'
import { Suspense, useEffect, useState } from 'react'
import { ListChecks, CheckCircle2 } from 'lucide-react'
import EnCours from './EnCours'
import Terminees from '../historique/Terminees'

type Tab = 'live' | 'done'

// Commandes : un seul module, deux vues — « En cours » (suivi live, ex Suivi) et « Terminées » (ex Historique : livrées + encaissées).
// /operations/historique redirige ici (?tab=done).
export default function CommandesPage() {
  const [tab, setTab] = useState<Tab>('live')
  useEffect(() => { const t = new URLSearchParams(window.location.search).get('tab'); if (t === 'done' || t === 'live') setTab(t) }, [])
  const go = (t: Tab) => { setTab(t); const hub = new URLSearchParams(window.location.search).get('hub'); window.history.replaceState(null, '', `/operations/suivi?tab=${t}${t === 'live' && hub ? `&hub=${hub}` : ''}`) }
  return (
    <div>
      <div className="px-4 md:px-6 pt-4 md:pt-6">
        <div className="flex gap-1 border-b border-gray-200">
          {([['live', 'En cours', ListChecks], ['done', 'Terminées', CheckCircle2]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => go(k)} className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-purple-600 text-purple-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}><I className="w-4 h-4" />{l}</button>
          ))}
        </div>
      </div>
      {tab === 'live' ? <Suspense fallback={null}><EnCours /></Suspense> : <Terminees />}
    </div>
  )
}
