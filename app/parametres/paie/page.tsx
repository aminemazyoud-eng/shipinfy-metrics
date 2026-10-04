'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Wallet, Save, Lock } from 'lucide-react'

interface Cfg { dailyRate: number; helperDailyRate: number; bonusThreshold: number; bonusPerOrder: number; onTimeBonus: number; noShowPenalty: number; latePenalty: number; paidLeave: boolean }

// Paramétrage → Paie & bonus : les règles de rémunération (le calcul mensuel est dans RH & Formation → Paie & Bonus).
export default function PaieSettingsPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [msg, setMsg] = useState('')
  const [bonusOrders, setBonusOrders] = useState(14)

  useEffect(() => { fetch('/api/ops/pay').then(async r => { const j = await r.json(); if (r.ok) setCfg(j.config); else setMsg(j.error || 'Accès réservé aux managers') }) }, [])
  const save = async (applyToAll: boolean) => {
    const r = await fetch('/api/ops/pay', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...cfg, applyToAll }) })
    setMsg(r.ok ? (applyToAll ? 'Règles enregistrées et fixes appliqués à tout le personnel.' : 'Règles enregistrées.') : 'Échec — rôle Manager requis')
  }
  const num = (k: keyof Cfg, label: string, hint: string) => cfg && (
    <label className="block text-sm"><span className="text-gray-700 font-medium">{label}</span>
      <input type="number" min={0} step="0.5" value={cfg[k] as number} onChange={e => setCfg({ ...cfg, [k]: Number(e.target.value) })} className="mt-1 w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
      <span className="text-xs text-gray-400">{hint}</span></label>
  )
  const sample = cfg ? Math.max(0, bonusOrders - cfg.bonusThreshold) * cfg.bonusPerOrder + bonusOrders * cfg.onTimeBonus : 0

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
      <div><h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Wallet className="w-5 h-5 text-purple-600" />Paie & bonus — règles</h1>
        <p className="text-sm text-gray-500">Rémunération = <b>fixe par jour pointé</b> + bonus de performance − retenues. Le pointage vient de RH & Formation → Pointage ; le calcul mensuel et l&apos;export CSV sont dans <Link href="/rh/paie" className="underline">RH & Formation → Paie & Bonus</Link>.</p></div>
      {msg && <div className="text-sm bg-purple-50 border border-purple-200 text-purple-800 rounded-lg p-3">{msg}</div>}
      {cfg && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-xs font-mono bg-gray-50 border border-gray-100 rounded-lg p-2.5 text-gray-600 mb-4 whitespace-pre-wrap">{'net = jours payés × fixe/jour\n    + Σ jours max(0 ; livrées du jour − seuil) × bonus/commande\n    + livrées dans le créneau × bonus ponctualité\n    − NO_SHOW × retenue − livrées hors créneau × retenue\n(le helper partage les livraisons du chauffeur de son véhicule)'}</div>
            <div className="grid sm:grid-cols-2 gap-4">
              {num('dailyRate', 'Fixe chauffeur / jour (MAD)', 'Versé pour chaque jour pointé présent ou en retard')}
              {num('helperDailyRate', 'Fixe helper / jour (MAD)', '')}
              {num('bonusThreshold', 'Seuil de bonus (commandes / jour)', 'Bonus au-delà de ce nombre de commandes livrées par l’équipe')}
              {num('bonusPerOrder', 'Bonus par commande au-delà (MAD)', '')}
              {num('onTimeBonus', 'Bonus par livraison dans le créneau (MAD)', '0 pour désactiver')}
              {num('noShowPenalty', 'Retenue par NO_SHOW (MAD)', '0 pour désactiver')}
              {num('latePenalty', 'Retenue par livraison hors créneau (MAD)', '0 pour désactiver')}
              <label className="flex items-center gap-2 text-sm text-gray-700 mt-6"><input type="checkbox" checked={cfg.paidLeave} onChange={e => setCfg({ ...cfg, paidLeave: e.target.checked })} />Congés payés</label>
            </div>
            <div className="flex flex-wrap gap-2 mt-5">
              <button onClick={() => save(false)} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-purple-600 text-white"><Save className="w-4 h-4" />Enregistrer</button>
              <button onClick={() => save(true)} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white" title="Applique les fixes chauffeur et helper à toutes les fiches du personnel">Enregistrer + appliquer à tout le personnel</button>
              <span className="flex items-center gap-1 text-xs text-gray-400"><Lock className="w-3.5 h-3.5" />Rôle Manager ou supérieur</span>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-sm font-semibold text-gray-800 mb-2">Simulateur de bonus journalier</div>
            <label className="text-sm text-gray-600">Commandes livrées dans la journée <input type="number" min={0} value={bonusOrders} onChange={e => setBonusOrders(Number(e.target.value))} className="ml-2 w-20 border border-gray-300 rounded-lg px-2 py-1" /></label>
            <div className="mt-2 text-2xl font-bold text-gray-900">+{sample.toLocaleString('fr-FR')} MAD <span className="text-sm font-normal text-gray-500">de bonus pour la journée (en plus du fixe de {cfg.dailyRate} MAD)</span></div>
          </div>
        </>
      )}
    </div>
  )
}
