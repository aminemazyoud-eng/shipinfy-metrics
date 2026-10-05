'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Wallet, Download, Clock } from 'lucide-react'

interface Cfg { dailyRate: number; helperDailyRate: number; bonusThreshold: number; bonusPerOrder: number; onTimeBonus: number; noShowPenalty: number; latePenalty: number; paidLeave: boolean }
interface Line { code: string; name: string; hubCode: string | null; dailyRate: number; paidDays: number; daysAbsent: number; delivered: number; onTime: number; noShow: number; bonusOrders: number; gross: number; bonus: number; deductions: number; net: number }
interface Pay { from: string; to: string; config: Cfg; lines: Line[]; totals: { gross: number; bonus: number; deductions: number; net: number; delivered: number } }

const mad = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`
const today = () => new Date().toISOString().slice(0, 10)

export default function PaieBonusPage() {
  const [from, setFrom] = useState(today().slice(0, 8) + '01'); const [to, setTo] = useState(today())
  const [pay, setPay] = useState<Pay | null>(null)
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [msg, setMsg] = useState('')
  const [hub, setHub] = useState('')

  const load = useCallback(async () => {
    const r = await fetch(`/api/ops/pay?from=${from}&to=${to}${hub ? `&hub=${hub}` : ''}`); const j = await r.json()
    if (r.ok) { setPay(j); setCfg(c => c ?? j.config); setMsg('') } else setMsg(j.error || 'Accès réservé aux managers')
  }, [from, to, hub])
  useEffect(() => { load() }, [load])

  const save = async (applyToAll: boolean) => {
    const r = await fetch('/api/ops/pay', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...cfg, applyToAll }) })
    setMsg(r.ok ? 'Règles enregistrées' : 'Échec — rôle Manager requis'); if (r.ok) load()
  }
  const num = (k: keyof Cfg, label: string, hint?: string) => cfg && (
    <label className="text-xs text-gray-600">{label}
      <input type="number" min={0} step="0.5" value={cfg[k] as number} onChange={e => setCfg({ ...cfg, [k]: Number(e.target.value) })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
      {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
    </label>
  )

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Wallet className="w-5 h-5 text-teal-600" />Paie & Bonus</h1>
          <p className="text-sm text-gray-500">Règles de rémunération (fixe journalier + bonus) · calculées depuis le <Link href="/pointage" className="underline">pointage</Link> et les livraisons — chauffeurs et helpers</p></div>
        <Link href="/operations/pointage" className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg bg-white flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Indicateurs côté Opérations</Link>
      </div>

      <div className="text-sm bg-purple-50 border border-purple-200 text-purple-800 rounded-lg p-3">Les <b>règles</b> de rémunération (fixe chauffeur / helper, bonus, retenues) se paramètrent dans <Link href="/parametres/paie" className="underline font-medium">Paramétrage → Paie & bonus</Link>. Cette page calcule la paie de la période à partir du pointage.</div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500">Au<input type="date" value={to} onChange={e => setTo(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <a href={`/api/ops/pay?from=${from}&to=${to}&format=xlsx`} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-teal-600 text-white"><Download className="w-4 h-4" />Fichier de paie (Excel)</a>
        <span className="text-sm text-gray-500">{msg}</span>
      </div>

      {pay && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[['Fixe (jours pointés)', pay.totals.gross], ['Bonus', pay.totals.bonus], ['Retenues', pay.totals.deductions], ['Net à payer', pay.totals.net]].map(([l, v]) => <div key={l as string} className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">{l}</div><div className="text-xl font-bold text-gray-900">{mad(v as number)}</div></div>)}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200">{['Personne', 'Hub', 'Fixe/jour', 'Jours payés', 'Absences', 'Livrées', 'Dans créneau', 'NO_SHOW', 'Cmd bonus', 'Brut', 'Bonus', 'Retenues', 'Net'].map(h => <th key={h} className="p-2 font-medium whitespace-nowrap first:pl-3">{h}</th>)}</tr></thead>
              <tbody>
                {pay.lines.map(l => (
                  <tr key={l.code} className="border-t border-gray-100"><td className="p-2 pl-3">{l.name} <span className="text-xs text-gray-400">{l.code}</span></td><td className="p-2 text-gray-500">{l.hubCode}</td><td className="p-2">{l.dailyRate}</td><td className="p-2">{l.paidDays}</td><td className="p-2 text-gray-500">{l.daysAbsent}</td><td className="p-2">{l.delivered}</td><td className="p-2">{l.onTime}</td><td className="p-2 text-gray-500">{l.noShow}</td><td className="p-2">{l.bonusOrders}</td><td className="p-2">{mad(l.gross)}</td><td className="p-2 text-green-700">{mad(l.bonus)}</td><td className="p-2 text-red-600">{l.deductions ? `−${mad(l.deductions)}` : '—'}</td><td className="p-2 font-semibold">{mad(l.net)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
