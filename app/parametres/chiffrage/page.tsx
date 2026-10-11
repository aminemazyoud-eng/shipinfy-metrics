'use client'
import { Calculator } from 'lucide-react'
import ParamsPanel from '@/app/operations/chiffrage/components/ParamsPanel'

// Paramétrage → Chiffrage & coûts : hypothèses de coût (chauffeur, helper, charges, carburant, entretien, véhicule, SI, prix facturé, objectifs).
// Lecture MANAGER, écriture ADMIN (contrôlé par l'API). Les résultats sont dans Opérations → Chiffrage.
export default function ChiffrageParamsPage() {
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Calculator className="w-5 h-5 text-purple-600" />Chiffrage &amp; coûts</h1>
        <p className="text-sm text-gray-500">Hypothèses utilisées pour calculer le coût par commande, la marge et les écarts vs objectif. Les résultats, le simulateur et les anomalies sont dans Opérations → Chiffrage.</p>
      </div>
      <ParamsPanel onSaved={() => {}} />
    </div>
  )
}
