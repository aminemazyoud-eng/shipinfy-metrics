'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { DollarSign, Users, TrendingUp, TrendingDown, Settings2, Loader2, CheckCircle2, ChevronDown, ChevronUp, Download } from 'lucide-react'

// Rémunération « à la course » (ex /remuneration) — reconstruite sur les commandes TEMPS RÉEL (/api/ops/pay-percourse),
// plus aucun rapport importé. Tarifs : /api/remuneration/config (PayConfig standard / express). Validation : onglet Clôture mensuelle.
interface DriverRow { code: string; driverName: string; total: number; deliveries: number; onTime: number; noShows: number; grossPay: number; bonus: number; penalty: number; netPay: number }
interface Result { from: string; to: string; mode: string; config: { baseRate: number; bonusRate: number; penaltyRate: number }; drivers: DriverRow[]; totals: { grossPay: number; bonus: number; penalty: number; netPay: number } }
interface Hist { period: string; total: number; delivered: number; deliveryRate: number; collected: number; payStatus: string | null }

const fmt = (n: number) => n.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)

export default function PerCourse({ onGoClosure }: { onGoClosure?: () => void }) {
  const [mode, setMode] = useState<'standard' | 'express'>('standard')
  const [from, setFrom] = useState(today().slice(0, 8) + '01'); const [to, setTo] = useState(today())
  const [res, setRes] = useState<Result | null>(null)
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(false)
  const [showCfg, setShowCfg] = useState(false)
  const [base, setBase] = useState(''); const [bonus, setBonus] = useState(''); const [pen, setPen] = useState('')
  const [savedCfg, setSavedCfg] = useState(false); const [savingCfg, setSavingCfg] = useState(false)
  const [sortBy, setSortBy] = useState<'netPay' | 'deliveries' | 'total'>('netPay'); const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [hist, setHist] = useState<{ name: string; items: Hist[] } | null>(null); const [histLoading, setHistLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/ops/pay-percourse?from=${from}&to=${to}&mode=${mode}`); const j = await r.json()
      if (r.ok) { setRes(j); setBase(String(j.config.baseRate)); setBonus(String(j.config.bonusRate)); setPen(String(j.config.penaltyRate)) } else { setRes(null); setErr(j.error || 'Accès réservé aux managers') }
    } catch { setErr('Erreur réseau') } finally { setLoading(false) }
  }, [from, to, mode])
  useEffect(() => { load() }, [load])

  const saveCfg = async () => {
    setSavingCfg(true); setSavedCfg(false)
    try {
      const r = await fetch('/api/remuneration/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, baseRate: parseFloat(base) || 0, bonusRate: parseFloat(bonus) || 0, penaltyRate: parseFloat(pen) || 0 }) })
      if (r.ok) { setSavedCfg(true); load(); setTimeout(() => setSavedCfg(false), 2000) } else setErr('Échec (rôle Manager requis)')
    } finally { setSavingCfg(false) }
  }
  const openHist = async (d: DriverRow) => {
    setHist({ name: d.driverName, items: [] }); setHistLoading(true)
    try { const r = await fetch(`/api/ops/pay-percourse?history=${encodeURIComponent(d.code)}`); if (r.ok) setHist({ name: d.driverName, items: (await r.json()).history ?? [] }) } finally { setHistLoading(false) }
  }
  const sorted = [...(res?.drivers ?? [])].sort((a, b) => { const x = a[sortBy] - b[sortBy]; return sortDir === 'desc' ? -x : x })
  const toggle = (c: typeof sortBy) => { if (sortBy === c) setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortBy(c); setSortDir('desc') } }
  const Ic = ({ c }: { c: typeof sortBy }) => sortBy !== c ? null : sortDir === 'desc' ? <ChevronDown size={12} className="inline ml-0.5" /> : <ChevronUp size={12} className="inline ml-0.5" />
  const th = 'px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide'
  const cfgFields: [string, string, (x: string) => void][] = [['Base / livraison (MAD)', base, setBase], ['Bonus dans le créneau (MAD)', bonus, setBonus], ['Pénalité NO_SHOW (MAD)', pen, setPen]]

  return (
    <div className="space-y-4">
      <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded-lg p-3">Rémunération à la course (tarif par livraison, bonus créneau, pénalité NO_SHOW), calculée en <b>temps réel</b> sur les commandes de la période — plus d&apos;import de rapport. La validation et le verrouillage du mois se font dans l&apos;onglet <button onClick={onGoClosure} className="underline font-medium">Clôture mensuelle</button>.</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500">Au<input type="date" value={to} onChange={e => setTo(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">{(['standard', 'express'] as const).map(m => <button key={m} onClick={() => setMode(m)} className={`px-3 py-2 text-xs font-medium ${mode === m ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{m === 'standard' ? 'Standard' : 'Express'}</button>)}</div>
        <button onClick={() => setShowCfg(v => !v)} className="flex items-center gap-1.5 px-3 py-2 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"><Settings2 size={14} />Tarifs</button>
        <a href={`/api/ops/pay-percourse?from=${from}&to=${to}&mode=${mode}&format=xlsx`} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white"><Download size={15} />Export Excel</a>
        {loading && <Loader2 size={16} className="animate-spin text-gray-400" />}
      </div>

      {showCfg && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-blue-800">Tarifs — Mode {mode === 'express' ? 'Express' : 'Standard'}</h3>{savedCfg && <span className="flex items-center gap-1 text-xs text-green-700"><CheckCircle2 size={13} />Enregistré</span>}</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {cfgFields.map(([l, v, s]) => (
              <div key={l}><label className="block text-xs text-blue-700 mb-1">{l}</label><input type="number" min="0" step="0.5" value={v} onChange={e => s(e.target.value)} className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white" /></div>
            ))}
          </div>
          <button onClick={saveCfg} disabled={savingCfg} className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg disabled:opacity-50">Enregistrer les tarifs</button>
        </div>
      )}
      {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{err}</div>}

      {res && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[{ l: 'Total NET à payer', v: `${fmt(res.totals.netPay)} MAD`, i: <DollarSign size={18} className="text-green-500" />, c: 'text-green-700' }, { l: 'Brut cumulé', v: `${fmt(res.totals.grossPay)} MAD`, i: <TrendingUp size={18} className="text-blue-500" />, c: 'text-blue-700' }, { l: 'Bonus créneau', v: `+${fmt(res.totals.bonus)} MAD`, i: <TrendingUp size={18} className="text-yellow-500" />, c: 'text-yellow-700' }, { l: 'Pénalités NO_SHOW', v: `-${fmt(res.totals.penalty)} MAD`, i: <TrendingDown size={18} className="text-red-500" />, c: 'text-red-700' }].map(c => (
              <div key={c.l} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3">{c.i}<div><div className={`text-base font-bold ${c.c}`}>{c.v}</div><div className="text-xs text-gray-500">{c.l}</div></div></div>
            ))}
          </div>
          <div className="flex items-center gap-4 px-4 py-2.5 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1"><Users size={12} /><strong>{res.drivers.length}</strong> livreurs</span>
            <span>Base : <strong>{res.config.baseRate} MAD</strong>/livraison</span><span>Bonus : <strong>+{res.config.bonusRate} MAD</strong> dans le créneau</span><span>Pénalité : <strong>-{res.config.penaltyRate} MAD</strong> NO_SHOW</span>
            <span className="capitalize font-semibold text-green-700">Mode {res.mode}</span>
          </div>
          {res.drivers.length === 0 ? <div className="py-12 text-center text-gray-400 border border-dashed border-gray-300 rounded-xl">Aucune commande assignée sur la période</div> : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>
                  <th className={th}>Livreur</th><th className={`${th} cursor-pointer`} onClick={() => toggle('total')}>Total <Ic c="total" /></th><th className={`${th} cursor-pointer`} onClick={() => toggle('deliveries')}>Livrées <Ic c="deliveries" /></th>
                  <th className={th}>Dans le créneau</th><th className={th}>NO_SHOW</th><th className={th}>Brut</th><th className={th}>Bonus</th><th className={th}>Pénalité</th><th className={`${th} cursor-pointer`} onClick={() => toggle('netPay')}>NET <Ic c="netPay" /></th><th className={th}></th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {sorted.map(d => (
                    <tr key={d.code}>
                      <td className="px-3 py-3 font-medium text-gray-900">{d.driverName} <span className="text-xs text-gray-400">{d.code}</span></td><td className="px-3 py-3 text-gray-600">{d.total}</td><td className="px-3 py-3 text-green-700 font-medium">{d.deliveries}</td>
                      <td className="px-3 py-3"><span className="text-blue-700 font-medium">{d.onTime}</span>{d.deliveries > 0 && <span className="text-xs text-gray-400 ml-1">({Math.round(d.onTime / d.deliveries * 100)}%)</span>}</td>
                      <td className="px-3 py-3 text-red-600">{d.noShows}</td><td className="px-3 py-3">{fmt(d.grossPay)}</td><td className="px-3 py-3 text-yellow-700">+{fmt(d.bonus)}</td><td className="px-3 py-3 text-red-600">-{fmt(d.penalty)}</td>
                      <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${d.netPay >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{fmt(d.netPay)} MAD</span></td>
                      <td className="px-3 py-3"><button onClick={() => openHist(d)} className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 whitespace-nowrap">Historique</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link href="/parametres/paie" className="inline-block text-xs underline text-gray-500">Règles de la paie journalière : Paramétrage → Paie & bonus</Link>
        </>
      )}

      {hist && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setHist(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100"><h3 className="font-bold text-gray-900">Historique 6 mois — {hist.name}</h3><button onClick={() => setHist(null)} className="w-8 h-8 rounded-full bg-gray-100 text-gray-500">✕</button></div>
            <div className="overflow-y-auto p-6">
              {histLoading ? <div className="text-center text-gray-400 py-8">Chargement…</div> : hist.items.length === 0 ? <div className="text-center text-gray-400 py-8">Aucun historique trouvé</div> : (
                <table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100"><th className="pb-2">Mois</th><th className="pb-2 text-right">Total</th><th className="pb-2 text-right">Livrées</th><th className="pb-2 text-right">Taux</th><th className="pb-2 text-right">Encaissé (MAD)</th><th className="pb-2 text-right">Paie</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">{hist.items.map(h => (
                    <tr key={h.period}><td className="py-2">{h.period}</td><td className="py-2 text-right">{h.total}</td><td className="py-2 text-right text-green-700">{h.delivered}</td>
                      <td className="py-2 text-right"><span className={`font-semibold ${h.deliveryRate >= 80 ? 'text-green-700' : h.deliveryRate >= 60 ? 'text-orange-600' : 'text-red-600'}`}>{h.deliveryRate.toFixed(1)}%</span></td>
                      <td className="py-2 text-right">{h.collected.toLocaleString('fr-MA')}</td>
                      <td className="py-2 text-right">{h.payStatus === 'paid' ? 'Payée' : h.payStatus === 'validated' ? 'Validée' : h.payStatus === 'draft' ? 'Brouillon' : 'En attente'}</td></tr>
                  ))}</tbody></table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
