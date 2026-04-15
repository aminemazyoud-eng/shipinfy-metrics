'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  DollarSign, Users, TrendingUp, TrendingDown,
  Calculator, Settings2, Loader2, CheckCircle2, ChevronDown, ChevronUp,
  Download, CheckSquare,
} from 'lucide-react'

interface Report { id: string; filename: string; uploadedAt: string }

interface PayConfig {
  id: string; mode: string; label: string
  baseRate: number; bonusRate: number; penaltyRate: number; active: boolean
}

interface DriverRow {
  driverName: string
  total: number; deliveries: number; onTime: number; noShows: number
  grossPay: number; bonus: number; penalty: number; netPay: number
}

interface CalcResult {
  reportId: string; mode: string
  config: { baseRate: number; bonusRate: number; penaltyRate: number }
  drivers: DriverRow[]
  totals: { grossPay: number; bonus: number; penalty: number; netPay: number }
}

function fmt(n: number) { return n.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function NetBadge({ net }: { net: number }) {
  const cls = net >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>{fmt(net)} MAD</span>
}

export default function RemunerationPage() {
  const [reports, setReports]   = useState<Report[]>([])
  const [reportId, setReportId] = useState('')
  const [mode, setMode]         = useState<'standard' | 'express'>('standard')
  const [configs, setConfigs]   = useState<PayConfig[]>([])
  const [result, setResult]     = useState<CalcResult | null>(null)
  const [calculating, setCalc]  = useState(false)
  const [calcError, setCalcErr] = useState('')

  // Config edit state
  const [showConfig, setShowConfig] = useState(false)
  const [editBase, setEditBase]     = useState('')
  const [editBonus, setEditBonus]   = useState('')
  const [editPenalty, setEditPenalty] = useState('')
  const [savingCfg, setSavingCfg]   = useState(false)
  const [savedCfg, setSavedCfg]     = useState(false)

  // Validation
  const [validating, setValidating]   = useState(false)
  const [validated, setValidated]     = useState(false)
  const [validatedBy, setValidatedBy] = useState('')
  const [userRole, setUserRole]       = useState('')

  // Sort
  const [sortBy, setSortBy]   = useState<'netPay' | 'deliveries' | 'total'>('netPay')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  // History modal
  const [historyModal, setHistoryModal] = useState<{ name: string } | null>(null)
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Load current user role
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then((d: { role?: string }) => {
      if (d?.role) setUserRole(d.role)
    }).catch(() => {})
  }, [])

  // Load reports
  useEffect(() => {
    fetch('/api/dashboard/reports').then(r => r.json()).then((rs: unknown) => {
      if (!Array.isArray(rs)) return
      setReports(rs as Report[])
      if (rs.length > 0) setReportId((rs[0] as Report).id)
    }).catch(() => {})
  }, [])

  // Load configs
  const loadConfigs = useCallback(async () => {
    const res = await fetch('/api/remuneration/config')
    if (res.ok) {
      const cfgs: PayConfig[] = await res.json()
      setConfigs(cfgs)
      const active = cfgs.find(c => c.mode === mode)
      if (active) {
        setEditBase(String(active.baseRate))
        setEditBonus(String(active.bonusRate))
        setEditPenalty(String(active.penaltyRate))
      }
    }
  }, [mode])

  useEffect(() => { loadConfigs() }, [loadConfigs])

  // Load saved result if exists
  useEffect(() => {
    if (!reportId) return
    fetch(`/api/remuneration?reportId=${reportId}&mode=${mode}`)
      .then(r => r.ok ? r.json() : null)
      .then((rows: DriverRow[] | null) => {
        if (!rows || rows.length === 0) { setResult(null); return }
        const cfg = configs.find(c => c.mode === mode)
        const totals = rows.reduce(
          (s, r) => ({
            grossPay: s.grossPay + r.grossPay,
            bonus:    s.bonus    + r.bonus,
            penalty:  s.penalty  + r.penalty,
            netPay:   s.netPay   + r.netPay,
          }),
          { grossPay: 0, bonus: 0, penalty: 0, netPay: 0 }
        )
        setResult({
          reportId, mode,
          config: { baseRate: cfg?.baseRate ?? 15, bonusRate: cfg?.bonusRate ?? 5, penaltyRate: cfg?.penaltyRate ?? 5 },
          drivers: rows,
          totals,
        })
      })
    // Load validation status
    fetch(`/api/remuneration/validate?reportId=${reportId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { payValidated?: boolean; payValidatedBy?: string } | null) => {
        if (d?.payValidated) { setValidated(true); setValidatedBy(d.payValidatedBy ?? '') }
        else { setValidated(false); setValidatedBy('') }
      }).catch(() => {})
  }, [reportId, mode, configs])

  const calculate = async () => {
    if (!reportId) return
    setCalc(true); setCalcErr('')
    try {
      const res = await fetch('/api/remuneration/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, mode }),
      })
      if (res.ok) { setResult(await res.json()) }
      else { const e = await res.json(); setCalcErr(e.error ?? 'Erreur calcul') }
    } catch { setCalcErr('Erreur réseau') }
    finally { setCalc(false) }
  }

  const saveConfig = async () => {
    setSavingCfg(true); setSavedCfg(false)
    try {
      const res = await fetch('/api/remuneration/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          baseRate:    parseFloat(editBase)   || 0,
          bonusRate:   parseFloat(editBonus)  || 0,
          penaltyRate: parseFloat(editPenalty) || 0,
        }),
      })
      if (res.ok) { setSavedCfg(true); await loadConfigs(); setTimeout(() => setSavedCfg(false), 2000) }
    } finally { setSavingCfg(false) }
  }

  const approvePay = async () => {
    if (!result?.reportId) return
    setValidating(true)
    try {
      const res = await fetch('/api/remuneration/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: result.reportId }),
      })
      if (res.ok) {
        const d = await res.json()
        setValidated(true)
        setValidatedBy(d.validatedBy ?? '')
      }
    } finally { setValidating(false) }
  }

  const isManager = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(userRole)

  const activeConfig = configs.find(c => c.mode === mode)

  const sorted = [...(result?.drivers ?? [])].sort((a, b) => {
    const diff = sortBy === 'netPay'     ? a.netPay     - b.netPay
               : sortBy === 'deliveries' ? a.deliveries - b.deliveries
               : a.total - b.total
    return sortDir === 'desc' ? -diff : diff
  })

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const openHistory = async (name: string) => {
    setHistoryModal({ name })
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/remuneration/history?driverName=${encodeURIComponent(name)}`)
      if (res.ok) {
        const d = await res.json()
        setHistoryItems(d.history ?? [])
      }
    } finally {
      setHistoryLoading(false)
    }
  }

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return null
    return sortDir === 'desc' ? <ChevronDown size={12} className="inline ml-0.5" /> : <ChevronUp size={12} className="inline ml-0.5" />
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6 p-3 md:p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <DollarSign className="h-5 w-5 lg:h-6 lg:w-6 text-green-600" />
            Rémunération Livreurs
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">
            Calcul automatique de la rémunération par course — Mode Standard &amp; Express
          </p>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          {/* Report selector */}
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            value={reportId}
            onChange={e => setReportId(e.target.value)}
          >
            {reports.length === 0
              ? <option value="">Aucun rapport importé</option>
              : reports.map(r => <option key={r.id} value={r.id}>{r.filename}</option>)
            }
          </select>

          {/* Mode toggle */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            {(['standard', 'express'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-2 text-xs font-medium capitalize transition ${mode === m ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {m === 'standard' ? 'Standard' : 'Express'}
              </button>
            ))}
          </div>

          {/* Config toggle */}
          <button
            onClick={() => setShowConfig(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
          >
            <Settings2 size={14} /> Tarifs
          </button>

          {/* Export CSV button */}
          {result && (
            <button
              onClick={() => window.open('/api/remuneration/export?reportId=' + result.reportId)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 min-h-[44px]"
            >
              <Download size={15} />
              <span>Export CSV</span>
            </button>
          )}

          {/* Calculate button */}
          <button
            onClick={calculate}
            disabled={calculating || !reportId}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 min-h-[44px]"
          >
            {calculating ? <Loader2 size={15} className="animate-spin" /> : <Calculator size={15} />}
            <span>{calculating ? 'Calcul…' : 'Calculer'}</span>
          </button>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-blue-800">
              Tarifs — Mode {mode === 'express' ? 'Express' : 'Standard'}
            </h3>
            {savedCfg && (
              <span className="flex items-center gap-1 text-xs text-green-700">
                <CheckCircle2 size={13} /> Enregistré
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { label: 'Base / livraison (MAD)', value: editBase,    set: setEditBase    },
              { label: 'Bonus on-time (MAD)',     value: editBonus,   set: setEditBonus   },
              { label: 'Pénalité NO_SHOW (MAD)',  value: editPenalty, set: setEditPenalty },
            ].map(f => (
              <div key={f.label}>
                <label className="block text-xs text-blue-700 mb-1">{f.label}</label>
                <input
                  type="number" min="0" step="0.5"
                  value={f.value}
                  onChange={e => f.set(e.target.value)}
                  className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                />
              </div>
            ))}
          </div>
          <button
            onClick={saveConfig}
            disabled={savingCfg}
            className="mt-3 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {savingCfg ? <Loader2 size={14} className="animate-spin" /> : null}
            Enregistrer les tarifs
          </button>
        </div>
      )}

      {/* Error */}
      {calcError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{calcError}</div>
      )}

      {/* Empty state */}
      {!result && !calculating && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 py-16 text-center">
          <Calculator size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">Sélectionnez un rapport et cliquez sur <strong>Calculer</strong></p>
          {activeConfig && (
            <p className="text-gray-400 text-xs mt-1">
              Tarifs actifs : {activeConfig.baseRate} MAD/livraison · +{activeConfig.bonusRate} MAD on-time · -{activeConfig.penaltyRate} MAD NO_SHOW
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
            {[
              { label: 'Total NET à payer',  value: `${fmt(result.totals.netPay)} MAD`,   icon: <DollarSign size={18} className="text-green-500" />,  color: 'text-green-700' },
              { label: 'Brut cumulé',        value: `${fmt(result.totals.grossPay)} MAD`, icon: <TrendingUp size={18} className="text-blue-500" />,    color: 'text-blue-700'  },
              { label: 'Bonus on-time',      value: `+${fmt(result.totals.bonus)} MAD`,   icon: <TrendingUp size={18} className="text-yellow-500" />,  color: 'text-yellow-700'},
              { label: 'Pénalités NO_SHOW',  value: `-${fmt(result.totals.penalty)} MAD`, icon: <TrendingDown size={18} className="text-red-500" />,   color: 'text-red-700'   },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 lg:p-4 flex items-center gap-2 lg:gap-3">
                {c.icon}
                <div>
                  <div className={`text-base lg:text-lg font-bold ${c.color}`}>{c.value}</div>
                  <div className="text-[10px] lg:text-xs text-gray-500">{c.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Config recap */}
          <div className="flex items-center gap-4 px-4 py-2.5 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Users size={12} /> <strong>{result.drivers.length}</strong> livreurs
            </span>
            <span>Base : <strong>{result.config.baseRate} MAD</strong>/livraison</span>
            <span>Bonus : <strong>+{result.config.bonusRate} MAD</strong> on-time</span>
            <span>Pénalité : <strong>-{result.config.penaltyRate} MAD</strong> NO_SHOW</span>
            <span className="capitalize font-semibold text-green-700">Mode {result.mode}</span>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Livreur</th>
                    <th
                      className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700"
                      onClick={() => toggleSort('total')}
                    >Total <SortIcon col="total" /></th>
                    <th
                      className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700"
                      onClick={() => toggleSort('deliveries')}
                    >Livrées <SortIcon col="deliveries" /></th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">On-Time</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">NO_SHOW</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Brut</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Bonus</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Pénalité</th>
                    <th
                      className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700"
                      onClick={() => toggleSort('netPay')}
                    >NET <SortIcon col="netPay" /></th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sorted.map((d, i) => (
                    <tr key={d.driverName} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-green-50 flex items-center justify-center text-green-700 font-bold text-xs flex-shrink-0">
                            {d.driverName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <span className="font-medium text-gray-900 truncate max-w-[140px]">{d.driverName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{d.total}</td>
                      <td className="px-3 py-3 text-green-700 font-medium">{d.deliveries}</td>
                      <td className="px-3 py-3">
                        <span className="text-blue-700 font-medium">{d.onTime}</span>
                        {d.deliveries > 0 && (
                          <span className="text-xs text-gray-400 ml-1">({Math.round(d.onTime / d.deliveries * 100)}%)</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-red-600">{d.noShows}</td>
                      <td className="px-3 py-3 text-gray-700">{fmt(d.grossPay)}</td>
                      <td className="px-3 py-3 text-yellow-700">+{fmt(d.bonus)}</td>
                      <td className="px-3 py-3 text-red-600">-{fmt(d.penalty)}</td>
                      <td className="px-3 py-3">
                        <NetBadge net={d.netPay} />
                      </td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() => openHistory(d.driverName)}
                          className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                        >
                          📋 Historique
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Footer totals */}
                <tfoot className="bg-gray-100 border-t-2 border-gray-200">
                  <tr>
                    <td className="px-3 py-3 font-bold text-gray-900" colSpan={6}>Total</td>
                    <td className="px-3 py-3 font-bold text-gray-700">{fmt(result.totals.grossPay)}</td>
                    <td className="px-3 py-3 font-bold text-yellow-700">+{fmt(result.totals.bonus)}</td>
                    <td className="px-3 py-3 font-bold text-red-600">-{fmt(result.totals.penalty)}</td>
                    <td className="px-3 py-3 font-bold text-green-700">{fmt(result.totals.netPay)} MAD</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          {/* Validation section */}
          {isManager && (
            <div className={`rounded-xl border p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 ${validated ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              <div>
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <CheckSquare size={15} className={validated ? 'text-green-600' : 'text-gray-500'} />
                  Validation de la paie
                </h3>
                {validated ? (
                  <p className="text-xs text-green-700 mt-0.5">
                    Approuvé par <strong>{validatedBy}</strong>
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Approuvez la paie pour ce rapport après vérification
                  </p>
                )}
              </div>
              {!validated ? (
                <button
                  onClick={approvePay}
                  disabled={validating}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 min-h-[40px]"
                >
                  {validating ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {validating ? 'Validation…' : 'Approuver la paie'}
                </button>
              ) : (
                <span className="flex items-center gap-1.5 text-sm font-semibold text-green-700 bg-green-100 px-3 py-1.5 rounded-lg">
                  <CheckCircle2 size={14} /> Paie approuvée
                </span>
              )}
            </div>
          )}
        </>
      )}

      {/* History modal */}
      {historyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">📋 Historique 6 mois — {historyModal.name}</h3>
              <button onClick={() => setHistoryModal(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">✕</button>
            </div>
            <div className="overflow-y-auto p-6">
              {historyLoading ? (
                <div className="text-center text-gray-400 py-8">Chargement…</div>
              ) : historyItems.length === 0 ? (
                <div className="text-center text-gray-400 py-8">Aucun historique trouvé</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="pb-2 pr-3">Rapport</th>
                      <th className="pb-2 pr-3 text-right">Total</th>
                      <th className="pb-2 pr-3 text-right">Livrées</th>
                      <th className="pb-2 pr-3 text-right">Taux</th>
                      <th className="pb-2 pr-3 text-right">COD (MAD)</th>
                      <th className="pb-2 text-right">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {historyItems.map((h: any) => (
                      <tr key={h.reportId}>
                        <td className="py-2 pr-3 text-gray-700 text-xs">{h.filename}</td>
                        <td className="py-2 pr-3 text-right">{h.total}</td>
                        <td className="py-2 pr-3 text-right text-green-700">{h.delivered}</td>
                        <td className="py-2 pr-3 text-right">
                          <span className={`font-semibold ${h.deliveryRate >= 80 ? 'text-green-700' : h.deliveryRate >= 60 ? 'text-orange-600' : 'text-red-600'}`}>
                            {h.deliveryRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right font-medium">{h.totalCOD.toLocaleString('fr-MA')}</td>
                        <td className="py-2 text-right">
                          {h.payValidated
                            ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ Approuvée</span>
                            : <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">En attente</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
