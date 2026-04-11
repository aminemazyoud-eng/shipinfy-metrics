'use client'
import { useEffect, useState, useCallback } from 'react'
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle,
  CheckCircle, RefreshCw, Package, Truck, Banknote,
  ChevronUp, ChevronDown,
} from 'lucide-react'
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'

// ── Types ───────────────────────────────────────────────────────────────────────
interface ForecastDay {
  date:      string
  dow:       number
  vol:       number
  volLow:    number
  volHigh:   number
  rate:      number
  rateLow:   number
  rateHigh:  number
  cod:       number
  codLow:    number
  codHigh:   number
  noShowEst: number
  risk:      'low' | 'medium' | 'high'
}
interface ByDay {
  date:         string
  total:        number
  delivered:    number
  noShow:       number
  deliveryRate: number
  cod:          number
}
interface HubTrend {
  hub:        string
  recentRate: number
  prevRate:   number
  trend:      number
  direction:  'up' | 'down' | 'stable'
  volume:     number
}
interface AtRisk {
  name:         string
  total:        number
  deliveryRate: number
  noShowRate:   number
  risk:         'high' | 'medium'
}
interface PrevisionData {
  reportId:      string
  totalOrders:   number
  globalRate:    number
  avgDaily:      number
  forecastTotal: number
  forecastRate:  number
  forecastCOD:   number
  byDay:         ByDay[]
  forecast:      ForecastDay[]
  hubTrends:     HubTrend[]
  atRisk:        AtRisk[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
const DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function riskColor(risk: string) {
  if (risk === 'high')   return { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    dot: 'bg-red-500'    }
  if (risk === 'medium') return { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: 'bg-orange-400' }
  return                        { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  dot: 'bg-green-500'  }
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
function fmtCod(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ── Stat card ───────────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon, label, value, sub, color, bg,
}: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string; bg: string
}) {
  return (
    <div className={`${bg} rounded-2xl p-4 flex items-start gap-3`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color.replace('text-', 'bg-').replace('600', '100').replace('700', '100')}`}>
        <Icon size={18} className={color} />
      </div>
      <div>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide leading-none">{label}</p>
        <p className={`text-2xl font-black ${color} leading-tight mt-1`}>{value}</p>
        {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Custom tooltip ───────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string; payload: { forecast?: boolean } }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const isForecast = payload[0]?.payload?.forecast
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs space-y-1 min-w-[140px]">
      <p className="font-bold text-gray-700 border-b border-gray-100 pb-1 mb-1">
        {label} {isForecast && <span className="text-blue-500 font-normal">· prévision</span>}
      </p>
      {payload.map(p => (
        <div key={p.name} className="flex justify-between gap-3">
          <span style={{ color: p.color }} className="font-medium">{p.name}</span>
          <span className="font-bold text-gray-700">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────────
export default function PrevisionsPage() {
  const [data, setData]       = useState<PrevisionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/previsions')
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Erreur'); setLoading(false); return }
      setData(json)
    } catch {
      setError('Impossible de charger les prévisions')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Build chart data: last 14 history days + 7 forecast ─────────────────────
  const chartData = data ? [
    ...data.byDay.slice(-14).map(d => ({
      label:    d.date.slice(5),
      vol:      d.total,
      rate:     d.deliveryRate,
      forecast: false,
    })),
    ...data.forecast.map(f => ({
      label:    `${DOW[f.dow]} ${f.date.slice(5)}`,
      vol:      f.vol,
      volLow:   f.volLow,
      volHigh:  f.volHigh,
      rate:     f.rate,
      rateLow:  f.rateLow,
      rateHigh: f.rateHigh,
      forecast: true,
    })),
  ] : []

  const todayLabel = data?.byDay[data.byDay.length - 1]?.date.slice(5)

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-full bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <RefreshCw size={28} className="animate-spin text-blue-500" />
        <p className="text-gray-500 text-sm">Calcul des prévisions...</p>
      </div>
    </div>
  )

  if (error || !data) return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-50 gap-4">
      <AlertTriangle size={40} className="text-orange-400" />
      <p className="text-gray-600 font-medium">{error ?? 'Aucune donnée'}</p>
      <p className="text-gray-400 text-sm text-center max-w-xs">
        Importez un fichier CSV depuis la page KPIs pour générer des prévisions.
      </p>
      <button onClick={load} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
        <RefreshCw size={14} /> Réessayer
      </button>
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
              <TrendingUp size={18} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Prévisions & Tendances</h1>
              <p className="text-xs text-gray-500">
                Basé sur {data.totalOrders.toLocaleString('fr-FR')} commandes ·
                {data.byDay.length} jours d&apos;historique
              </p>
            </div>
          </div>
          <button onClick={load} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            <RefreshCw size={13} />
            Actualiser
          </button>
        </div>
      </div>

      <div className="p-3 md:p-4 lg:p-5 space-y-4 lg:space-y-5">

        {/* ── KPI summary ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon={Package}
            label="Volume prévu 7j"
            value={fmt(data.forecastTotal)}
            sub={`~${Math.round(data.forecastTotal / 7)}/jour`}
            color="text-blue-600"
            bg="bg-blue-50"
          />
          <KpiCard
            icon={Truck}
            label="Taux livraison prévu"
            value={`${data.forecastRate}%`}
            sub={`Actuel: ${data.globalRate}%`}
            color={data.forecastRate >= 75 ? 'text-green-600' : data.forecastRate >= 65 ? 'text-orange-600' : 'text-red-600'}
            bg={data.forecastRate >= 75 ? 'bg-green-50' : data.forecastRate >= 65 ? 'bg-orange-50' : 'bg-red-50'}
          />
          <KpiCard
            icon={Banknote}
            label="COD attendu 7j"
            value={fmtCod(data.forecastCOD)}
            sub={`~${fmtCod(Math.round(data.forecastCOD / 7))}/jour`}
            color="text-emerald-600"
            bg="bg-emerald-50"
          />
          <KpiCard
            icon={data.forecastRate >= 75 ? CheckCircle : AlertTriangle}
            label="Commandes / jour moy."
            value={String(data.avgDaily)}
            sub={`Sur ${data.byDay.length} jours`}
            color="text-purple-600"
            bg="bg-purple-50"
          />
        </div>

        {/* ── 7-day forecast cards ─────────────────────────────────────────── */}
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2.5">Prévisions jour par jour — 7 prochains jours</p>
          <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
            {data.forecast.map(f => {
              const c = riskColor(f.risk)
              return (
                <div key={f.date} className={`${c.bg} ${c.border} border rounded-xl p-3 flex flex-col gap-1.5`}>
                  {/* Date */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-500">{DOW[f.dow]}</span>
                    <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                  </div>
                  <p className="text-[10px] text-gray-400">{f.date.slice(5)}</p>

                  {/* Volume */}
                  <div className="mt-1">
                    <p className="text-xs text-gray-500">Volume</p>
                    <p className={`text-base font-black ${c.text} leading-none`}>{f.vol}</p>
                    <p className="text-[9px] text-gray-400">{f.volLow}–{f.volHigh}</p>
                  </div>

                  {/* Rate */}
                  <div>
                    <p className="text-xs text-gray-500">Taux livr.</p>
                    <p className={`text-sm font-black ${c.text} leading-none`}>{f.rate}%</p>
                  </div>

                  {/* NO_SHOW */}
                  <div className="pt-1 border-t border-current/10">
                    <p className="text-[9px] text-gray-400">NO_SHOW est.</p>
                    <p className="text-xs font-bold text-gray-600">{f.noShowEst}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Combined chart ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-bold text-gray-800">Volume & Taux de livraison</p>
              <p className="text-xs text-gray-400">14 derniers jours (historique) + 7 prochains jours (prévision)</p>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-5 h-0.5 bg-gray-300 inline-block" /> Historique</span>
              <span className="flex items-center gap-1"><span className="w-5 h-0.5 bg-blue-500 inline-block border-dashed border" /> Prévision</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} />
              <YAxis yAxisId="vol" tick={{ fontSize: 9, fill: '#9ca3af' }} />
              <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={{ fontSize: 9, fill: '#9ca3af' }} unit="%" />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: '10px' }} />

              {/* Reference line = today */}
              {todayLabel && (
                <ReferenceLine
                  yAxisId="vol"
                  x={todayLabel}
                  stroke="#3b82f6"
                  strokeDasharray="4 2"
                  label={{ value: 'Aujourd\'hui', position: 'insideTopLeft', fontSize: 9, fill: '#3b82f6' }}
                />
              )}

              {/* Historical volume bars */}
              <Bar
                yAxisId="vol"
                dataKey="vol"
                name="Volume"
                fill="#bfdbfe"
                radius={[3, 3, 0, 0]}
                maxBarSize={24}
              />

              {/* Rate line */}
              <Line
                yAxisId="rate"
                dataKey="rate"
                name="Taux (%)"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* ── Hub trends + At risk ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* Hub trends */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-sm font-bold text-gray-800 mb-1">Tendances par Hub</p>
            <p className="text-[11px] text-gray-400 mb-3">7 derniers jours vs 7 précédents</p>
            {data.hubTrends.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Données insuffisantes</p>
            ) : (
              <div className="space-y-2">
                {data.hubTrends.map(h => (
                  <div key={h.hub} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    {/* Direction icon */}
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      h.direction === 'up'   ? 'bg-green-100' :
                      h.direction === 'down' ? 'bg-red-100'   : 'bg-gray-100'
                    }`}>
                      {h.direction === 'up'     ? <ChevronUp   size={14} className="text-green-600" />  :
                       h.direction === 'down'   ? <ChevronDown size={14} className="text-red-600" />    :
                                                  <Minus       size={14} className="text-gray-400" />   }
                    </div>

                    {/* Hub name */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{h.hub}</p>
                      <p className="text-[10px] text-gray-400">{h.volume} commandes</p>
                    </div>

                    {/* Rates */}
                    <div className="text-right">
                      <p className={`text-sm font-black ${
                        h.direction === 'up' ? 'text-green-600' :
                        h.direction === 'down' ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {h.recentRate}%
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {h.trend > 0 ? '+' : ''}{h.trend}pp vs avant
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* At-risk livreurs */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-800">Livreurs à Risque</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                data.atRisk.length > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
              }`}>
                {data.atRisk.length} détecté{data.atRisk.length !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">Taux de livraison &lt; 78% (min. 10 commandes)</p>

            {data.atRisk.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <CheckCircle size={28} className="text-green-400" />
                <p className="text-sm text-green-600 font-medium">Aucun livreur à risque</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.atRisk.map(l => (
                  <div key={l.name} className={`flex items-center gap-3 p-2.5 rounded-xl border ${
                    l.risk === 'high' ? 'bg-red-50 border-red-100' : 'bg-orange-50 border-orange-100'
                  }`}>
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-black ${
                      l.risk === 'high' ? 'bg-red-200 text-red-700' : 'bg-orange-200 text-orange-700'
                    }`}>
                      {l.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{l.name}</p>
                      <p className="text-[10px] text-gray-500">{l.total} cdes · NO_SHOW {l.noShowRate}%</p>
                    </div>

                    {/* Rate */}
                    <div className="text-right">
                      <p className={`text-sm font-black ${l.risk === 'high' ? 'text-red-600' : 'text-orange-600'}`}>
                        {l.deliveryRate}%
                      </p>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        l.risk === 'high' ? 'bg-red-200 text-red-700' : 'bg-orange-200 text-orange-700'
                      }`}>
                        {l.risk === 'high' ? 'Critique' : 'Moyen'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* ── Methodology note ────────────────────────────────────────────── */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-2.5">
          <TrendingUp size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-blue-600 leading-relaxed">
            <span className="font-bold">Méthodologie :</span> Régression linéaire + moyenne mobile 7j + facteur saisonnier jour de la semaine.
            Intervalles de confiance basés sur l&apos;erreur quadratique (RMSE) des 7 derniers jours.
            Les prévisions sont indicatives — elles se basent sur {data.byDay.length} jours d&apos;historique.
          </p>
        </div>

      </div>
    </div>
  )
}
