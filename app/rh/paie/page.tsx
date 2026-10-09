'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Wallet, Download, Clock, Lock, RefreshCw, CheckCircle2, Banknote, Unlock } from 'lucide-react'

interface Cfg { dailyRate: number; helperDailyRate: number; bonusThreshold: number; bonusPerOrder: number; onTimeBonus: number; noShowPenalty: number; latePenalty: number; paidLeave: boolean }
interface Line { code: string; name: string; hubCode: string | null; dailyRate: number; paidDays: number; daysAbsent: number; delivered: number; onTime: number; noShow: number; bonusOrders: number; gross: number; bonus: number; deductions: number; net: number }
interface Pay { from: string; to: string; locked?: boolean; status?: string | null; message?: string; config: Cfg; lines: Line[]; totals: { gross: number; bonus: number; deductions: number; net: number; delivered: number } }

const mad = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`
const today = () => new Date().toISOString().slice(0, 10)

export default function PaieBonusPage() {
  const [tab, setTab] = useState<'live' | 'runs'>('live')
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

      <div className="flex gap-2">{([['live', 'Calcul en cours'], ['runs', 'Clôtures mensuelles']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-4 py-1.5 rounded-lg text-sm border ${tab === k ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-300'}`}>{l}</button>)}</div>

      {tab === 'runs' && <Closures />}

      {tab === 'live' && <>
      <div className="text-sm bg-purple-50 border border-purple-200 text-purple-800 rounded-lg p-3">Les <b>règles</b> de rémunération (fixe chauffeur / helper, bonus, retenues) se paramètrent dans <Link href="/parametres/paie" className="underline font-medium">Paramétrage → Paie & bonus</Link>. Cette page calcule la paie de la période à partir du pointage.</div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500">Au<input type="date" value={to} onChange={e => setTo(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <a href={`/api/ops/pay?from=${from}&to=${to}&format=xlsx`} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-teal-600 text-white"><Download className="w-4 h-4" />Fichier de paie (Excel)</a>
        <span className="text-sm text-gray-500">{msg}</span>
      </div>

      {pay?.locked && <div className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3"><Lock className="w-4 h-4" />Période verrouillée ({pay.status === 'paid' ? 'payée' : 'validée'}) : valeurs figées, tarifs et jours du jour de la validation. {pay.message}</div>}
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
      </>}
    </div>
  )
}

// ───────── Clôtures mensuelles (Sprint 18) ─────────
interface RunSummary { period: string; status: 'draft' | 'validated' | 'paid'; totals: { final: number; net: number } | null; validatedBy: string | null; validatedAt: string | null; paidAt: string | null }
interface RLine { code: string; name: string; hubCode: string | null; dailyRate: number; paidDays: number; daysAbsent: number; delivered: number; noShow: number; gross: number; bonus: number; deductions: number; net: number; adjustment: number; adjustmentNote: string | null; final: number }
interface RunDetail { period: string; status: 'draft' | 'validated' | 'paid'; locked: boolean; config: Cfg | null; totals: { gross: number; bonus: number; deductions: number; net: number; adjustments: number; final: number }; note: string | null; validatedBy: string | null; validatedAt: string | null; paidBy: string | null; paidAt: string | null; lines: RLine[] }
const STATUS: Record<string, [string, string]> = { draft: ['Brouillon', 'bg-gray-100 text-gray-700'], validated: ['Validée', 'bg-amber-100 text-amber-800'], paid: ['Payée', 'bg-green-100 text-green-800'] }
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' }) : '—')
const prevMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) }

function Closures() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [canValidate, setCanValidate] = useState(false)
  const [sel, setSel] = useState<string>(prevMonth())
  const [run, setRun] = useState<RunDetail | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const loadList = useCallback(async () => { const r = await fetch('/api/ops/payrun'); if (r.ok) { const j = await r.json(); setRuns(j.runs); setCanValidate(j.canValidate) } else setMsg('Accès réservé aux managers') }, [])
  const loadRun = useCallback(async (p: string) => {
    const r = await fetch(`/api/ops/payrun/${p}`)
    if (r.ok) { const j = await r.json(); setRun(j.run); setCanValidate(j.canValidate) } else setRun(null)
  }, [])
  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { if (/^\d{4}-\d\d$/.test(sel)) loadRun(sel) }, [sel, loadRun])

  const act = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true)
    const r = await fetch(`/api/ops/payrun/${sel}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (r.ok) { setRun(j.run); setMsg(okMsg); loadList() } else setMsg(j.error || 'Échec')
  }
  const adjust = (l: RLine) => {
    const a = window.prompt(`Ajustement manuel pour ${l.name} (MAD, ± 5000, 0 pour annuler)`, String(l.adjustment)); if (a === null) return
    const amount = Number(a.replace(',', '.')); if (!Number.isFinite(amount)) { setMsg('Montant invalide'); return }
    const note = amount === 0 ? '' : window.prompt('Note (obligatoire)', l.adjustmentNote ?? '') ?? ''
    act({ action: 'adjust', driverCode: l.code, amount, note }, 'Ajustement enregistré')
  }
  const reopen = () => { const reason = window.prompt('Motif de la réouverture (obligatoire, journalisé)'); if (reason) act({ action: 'reopen', reason }, 'Clôture rouverte en brouillon') }
  const st = run ? STATUS[run.status] : null

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200">{['Mois', 'Statut', 'Net final', 'Validée le', 'Par', ''].map(h => <th key={h} className="p-2 font-medium first:pl-3">{h}</th>)}</tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={6} className="p-3 text-gray-400">Aucune clôture : choisissez un mois ci-dessous et calculez le brouillon.</td></tr>}
            {runs.map(r => (
              <tr key={r.period} className={`border-t border-gray-100 cursor-pointer ${sel === r.period ? 'bg-teal-50' : ''}`} onClick={() => setSel(r.period)}>
                <td className="p-2 pl-3 font-medium">{r.period}</td>
                <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
                <td className="p-2">{r.totals ? mad(r.totals.final) : '—'}</td><td className="p-2 text-gray-500">{dt(r.validatedAt)}</td><td className="p-2 text-gray-500">{r.validatedBy ?? '—'}</td>
                <td className="p-2 text-xs text-teal-700">Détail</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Mois<input type="month" value={sel} onChange={e => setSel(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        {(!run || run.status === 'draft') && <button disabled={busy} onClick={() => act({ action: 'draft' }, 'Brouillon calculé')} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-teal-600 text-teal-700 disabled:opacity-50"><RefreshCw className="w-4 h-4" />{run ? 'Recalculer le brouillon' : 'Calculer le brouillon'}</button>}
        {run?.status === 'draft' && canValidate && <button disabled={busy} onClick={() => window.confirm(`Valider la paie de ${sel} ? Le mois sera figé (tarifs et jours).`) && act({ action: 'validate' }, 'Paie validée : mois figé')} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-teal-600 text-white disabled:opacity-50"><CheckCircle2 className="w-4 h-4" />Valider</button>}
        {run?.status === 'validated' && canValidate && <button disabled={busy} onClick={() => window.confirm('Marquer cette paie comme payée ?') && act({ action: 'paid' }, 'Paie marquée payée')} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-green-600 text-white disabled:opacity-50"><Banknote className="w-4 h-4" />Marquer payée</button>}
        {run?.status === 'validated' && canValidate && <button disabled={busy} onClick={reopen} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-red-300 text-red-700 disabled:opacity-50"><Unlock className="w-4 h-4" />Rouvrir</button>}
        {run && <a href={`/api/ops/payrun/${sel}?format=xlsx`} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-gray-100 border border-gray-200 text-gray-700"><Download className="w-4 h-4" />Export Excel du mois</a>}
        <span className="text-sm text-gray-500">{msg}</span>
      </div>

      {!run && <div className="text-sm text-gray-500">Aucune clôture pour {sel}.</div>}
      {run && st && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`text-xs px-2 py-0.5 rounded-full ${st[1]}`}>{st[0]}</span>
            {run.locked && <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800"><Lock className="w-3 h-3" />Période verrouillée</span>}
            {run.locked ? <span className="text-gray-500">Figée le {dt(run.validatedAt)} par {run.validatedBy}{run.paidAt ? ` · payée le ${dt(run.paidAt)} (${run.paidBy})` : ''} : tarifs et jours enregistrés, aucun recalcul.</span> : <span className="text-gray-500">Brouillon recalculable au tarif courant ; les ajustements saisis sont conservés.</span>}
          </div>
          {run.config && <div className="text-xs text-gray-500">Barème figé : fixe chauffeur {run.config.dailyRate} · helper {run.config.helperDailyRate} · seuil bonus {run.config.bonusThreshold} · {run.config.bonusPerOrder}/cmd · ponctualité {run.config.onTimeBonus} · NO_SHOW −{run.config.noShowPenalty} · retard −{run.config.latePenalty} · congés {run.config.paidLeave ? 'payés' : 'non payés'}</div>}
          {run.note && <div className="text-xs whitespace-pre-line text-gray-500 bg-gray-50 rounded-lg p-2">{run.note}</div>}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[['Fixe', run.totals.gross], ['Bonus', run.totals.bonus], ['Retenues', run.totals.deductions], ['Ajustements', run.totals.adjustments], ['Net final', run.totals.final]].map(([l, v]) => <div key={l as string} className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">{l}</div><div className="text-xl font-bold text-gray-900">{mad(v as number)}</div></div>)}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200">{['Personne', 'Hub', 'Tarif/jour (figé)', 'Jours payés', 'Absences', 'Livrées', 'NO_SHOW', 'Brut', 'Bonus', 'Retenues', 'Net calculé', 'Ajustement', 'Net final'].map(h => <th key={h} className="p-2 font-medium whitespace-nowrap first:pl-3">{h}</th>)}</tr></thead>
              <tbody>
                {run.lines.map(l => (
                  <tr key={l.code} className="border-t border-gray-100">
                    <td className="p-2 pl-3">{l.name} <span className="text-xs text-gray-400">{l.code}</span></td><td className="p-2 text-gray-500">{l.hubCode}</td><td className="p-2">{l.dailyRate}</td><td className="p-2">{l.paidDays}</td><td className="p-2 text-gray-500">{l.daysAbsent}</td><td className="p-2">{l.delivered}</td><td className="p-2 text-gray-500">{l.noShow}</td>
                    <td className="p-2">{mad(l.gross)}</td><td className="p-2 text-green-700">{mad(l.bonus)}</td><td className="p-2 text-red-600">{l.deductions ? `−${mad(l.deductions)}` : '—'}</td><td className="p-2">{mad(l.net)}</td>
                    <td className="p-2 whitespace-nowrap">{l.adjustment ? <span title={l.adjustmentNote ?? ''} className={l.adjustment > 0 ? 'text-green-700' : 'text-red-600'}>{l.adjustment > 0 ? '+' : ''}{mad(l.adjustment)}</span> : '—'}{run.status === 'draft' && <button onClick={() => adjust(l)} className="ml-2 text-xs underline text-teal-700">±</button>}</td>
                    <td className="p-2 font-semibold">{mad(l.final)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
