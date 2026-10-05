'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Wallet, Download, ArrowRight } from 'lucide-react'

interface Line { code: string; name: string; paidDays: number; delivered: number; bonusOrders: number; bonus: number; net: number }
interface Pay { from: string; to: string; lines: Line[]; totals: { gross: number; bonus: number; deductions: number; net: number } }
const mad = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} MAD`

// Paie & bonus du mois, calculés à partir de CE pointage (RH) + des livraisons du cockpit Opérations.
export default function PayBonusCard() {
  const [pay, setPay] = useState<Pay | null>(null)
  const [denied, setDenied] = useState(false)
  useEffect(() => { fetch('/api/ops/pay').then(async r => { if (r.ok) setPay(await r.json()); else setDenied(true) }).catch(() => setDenied(true)) }, [])
  if (denied) return null
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="font-semibold text-gray-900 flex items-center gap-2"><Wallet className="w-4 h-4 text-teal-600" />Paie & bonus du mois {pay && <span className="text-xs font-normal text-gray-400">{pay.from} → {pay.to}</span>}</div>
        <div className="flex gap-2">
          {pay && <a href={`/api/ops/pay?from=${pay.from}&to=${pay.to}&format=xlsx`} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-gray-700"><Download className="w-3.5 h-3.5" />Fichier de paie (Excel)</a>}
          <Link href="/operations/pointage" className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-teal-300 text-teal-700">Règles & détail dans Opérations <ArrowRight className="w-3.5 h-3.5" /></Link>
        </div>
      </div>
      {pay && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {[['Fixe (jours pointés)', pay.totals.gross], ['Bonus', pay.totals.bonus], ['Retenues', pay.totals.deductions], ['Net à payer', pay.totals.net]].map(([l, v]) => <div key={l as string} className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-500">{l}</div><div className="text-lg font-bold text-gray-900">{mad(v as number)}</div></div>)}
          </div>
          <div className="mt-3 text-xs text-gray-500">Meilleurs bonus : {pay.lines.filter(l => l.bonus > 0).sort((a, b) => b.bonus - a.bonus).slice(0, 3).map(l => `${l.name} (+${mad(l.bonus)})`).join(' · ') || 'aucun bonus ce mois-ci'}</div>
        </>
      )}
    </div>
  )
}
