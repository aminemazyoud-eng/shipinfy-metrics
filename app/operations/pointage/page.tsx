'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Clock, Download, Wallet, CheckCheck, RefreshCw } from 'lucide-react'
import OpsNav from '../components/OpsNav'

interface Att { code: string; name: string; hubCode: string | null; hubName: string | null; dailyRate: number; status: string | null; checkIn: string | null; checkOut: string | null; delivered: number }
interface Cfg { dailyRate: number; bonusThreshold: number; bonusPerOrder: number; onTimeBonus: number; noShowPenalty: number; latePenalty: number; paidLeave: boolean }
interface Line { code: string; name: string; hubCode: string | null; dailyRate: number; paidDays: number; daysLate: number; daysAbsent: number; daysLeave: number; delivered: number; onTime: number; deliveredLate: number; noShow: number; bonusOrders: number; gross: number; bonus: number; deductions: number; net: number }
interface Pay { from: string; to: string; config: Cfg; lines: Line[]; totals: { gross: number; bonus: number; deductions: number; net: number; delivered: number } }

const BTN = [['present', 'Présent', 'bg-green-600'], ['late', 'Retard', 'bg-amber-500'], ['absent', 'Absent', 'bg-red-600'], ['leave', 'Congé', 'bg-gray-500']] as const
const t = (d: string | null) => (d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' }) : '—')
const mad = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`
const monthStart = () => new Date().toISOString().slice(0, 8) + '01'
const today = () => new Date().toISOString().slice(0, 10)

export default function PointagePage() {
  const [tab, setTab] = useState<'pointage' | 'paie'>('pointage')
  const [day, setDay] = useState(today())
  const [rows, setRows] = useState<Att[]>([])
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today())
  const [pay, setPay] = useState<Pay | null>(null)
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [msg, setMsg] = useState('')

  const loadAtt = useCallback(async () => { const r = await fetch(`/api/ops/attendance?day=${day}`); if (r.ok) setRows((await r.json()).drivers) }, [day])
  const loadPay = useCallback(async () => {
    const r = await fetch(`/api/ops/pay?from=${from}&to=${to}`); const j = await r.json()
    if (r.ok) { setPay(j); setCfg(c => c ?? j.config); setMsg('') } else setMsg(j.error || 'Erreur')
  }, [from, to])
  useEffect(() => { if (tab === 'pointage') loadAtt() }, [tab, loadAtt])
  useEffect(() => { if (tab === 'paie') loadPay() }, [tab, loadPay])

  const mark = async (code: string, status: string) => {
    await fetch('/api/ops/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, driverCode: code, status, ...(status === 'present' || status === 'late' ? { checkIn: 'now' } : {}) }) }); loadAtt()
  }
  const checkOut = async (code: string) => { await fetch('/api/ops/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, driverCode: code, checkOut: 'now' }) }); loadAtt() }
  const allPresent = async () => { await fetch('/api/ops/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, all: true, status: 'present' }) }); loadAtt() }
  const saveCfg = async (applyToAll: boolean) => {
    const r = await fetch('/api/ops/pay', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...cfg, applyToAll }) })
    setMsg(r.ok ? 'Configuration enregistrée' : 'Échec (rôle Manager requis)'); if (r.ok) loadPay()
  }

  const count = (s: string) => rows.filter(r => r.status === s).length
  const num = (k: keyof Cfg, label: string, hint?: string) => cfg && (
    <label className="text-xs text-gray-600">{label}
      <input type="number" min={0} step="0.5" value={cfg[k] as number} onChange={e => setCfg({ ...cfg, [k]: Number(e.target.value) })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
      {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
    </label>
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Clock className="w-5 h-5 text-purple-600" />Pointage & paie</h1></div>
      <OpsNav />
      <div className="flex gap-2">{([['pointage', 'Pointage du jour', Clock], ['paie', 'Paie & bonus', Wallet]] as const).map(([k, l, I]) => <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm border ${tab === k ? 'bg-purple-600 text-white border-purple-600' : 'bg-white border-gray-300'}`}><I className="w-4 h-4" />{l}</button>)}</div>

      {tab === 'pointage' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <input type="date" value={day} onChange={e => setDay(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
            <button onClick={allPresent} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-green-600 text-white"><CheckCheck className="w-4 h-4" />Tout le monde présent</button>
            <button onClick={loadAtt} className="p-2 border border-gray-300 rounded-lg bg-white"><RefreshCw className="w-4 h-4" /></button>
            <span className="text-sm text-gray-500">{count('present')} présents · {count('late')} en retard · {count('absent')} absents · {count('leave')} congés · {rows.filter(r => !r.status).length} non pointés</span>
          </div>
          <div className="text-xs bg-teal-50 border border-teal-200 text-teal-800 rounded-lg p-3">Source unique : le pointage est celui de <Link href="/pointage" className="underline font-medium">RH & Formation → Pointage</Link> (QR, saisie manuelle). Les boutons ci-dessous écrivent dans ce même pointage. Il se fait à la journée ; le nombre de commandes livrées ne sert qu&apos;aux bonus.</div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200"><th className="p-2 pl-3 font-medium">Livreur</th><th className="p-2 font-medium">Hub</th><th className="p-2 font-medium">Statut du jour</th><th className="p-2 font-medium">Arrivée</th><th className="p-2 font-medium">Départ</th><th className="p-2 font-medium">Livrées</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.code} className="border-t border-gray-100">
                    <td className="p-2 pl-3">{r.name} <span className="text-xs text-gray-400">{r.code}</span></td><td className="p-2 text-gray-500">{r.hubName?.replace('Marjane ', '')}</td>
                    <td className="p-2"><div className="flex gap-1">{BTN.map(([s, l, c]) => <button key={s} onClick={() => mark(r.code, s)} className={`px-2.5 py-1 rounded-md text-xs ${r.status === s ? `${c} text-white` : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{l}</button>)}</div></td>
                    <td className="p-2 text-gray-600">{t(r.checkIn)}</td>
                    <td className="p-2">{r.checkOut ? t(r.checkOut) : r.checkIn ? <button onClick={() => checkOut(r.code)} className="text-xs px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-50">Pointer départ</button> : '—'}</td>
                    <td className="p-2 text-gray-700">{r.delivered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'paie' && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-500">Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
            <label className="text-xs text-gray-500">Au<input type="date" value={to} onChange={e => setTo(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
            <a href={`/api/ops/pay?from=${from}&to=${to}&format=xlsx`} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-purple-600 text-white"><Download className="w-4 h-4" />Exporter le fichier de paie (Excel)</a>
          </div>
          {msg && <div className="text-sm text-gray-600">{msg}</div>}

          <div className="text-xs bg-purple-50 border border-purple-200 text-purple-800 rounded-lg p-3">Les règles de rémunération (fixe, bonus, retenues) se gèrent dans <Link href="/rh/paie" className="underline font-medium">RH & Formation → Paie & Bonus</Link>. Ici : indicateurs de la période.</div>

          {pay && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[['Brut (fixe)', pay.totals.gross], ['Bonus', pay.totals.bonus], ['Retenues', pay.totals.deductions], ['Net à payer', pay.totals.net]].map(([l, v]) => <div key={l as string} className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">{l}</div><div className="text-xl font-bold text-gray-900">{mad(v as number)}</div></div>)}
              </div>
              <Link href="/rh/paie" className="inline-block text-sm px-3 py-1.5 rounded-lg border border-purple-300 text-purple-700">Voir le détail par personne dans Paie & Bonus →</Link>
            </>
          )}
        </>
      )}
    </div>
  )
}
