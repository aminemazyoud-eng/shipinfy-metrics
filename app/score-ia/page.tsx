'use client'
import { useEffect, useState, useCallback } from 'react'
import { Brain, RefreshCw, TrendingUp, AlertTriangle, CheckCircle, Target } from 'lucide-react'

interface ScoreEntry {
  id: string
  driverName: string
  deliveryRate: number
  academyScore: number
  noShowRate: number
  score: number
  recommendation: string | null
  calculatedAt: string
}

function ScoreBadge({ score }: { score: number }) {
  const config = score >= 80
    ? { bg: 'bg-green-100',  text: 'text-green-700',  border: 'border-green-200',  label: '✅ Excellent' }
    : score >= 60
    ? { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', label: '⚠️ Moyen' }
    : { bg: 'bg-red-100',    text: 'text-red-700',    border: 'border-red-200',    label: '🔴 Critique' }
  return (
    <div className={`inline-flex flex-col items-center justify-center w-14 h-14 rounded-xl border ${config.bg} ${config.border}`}>
      <span className={`text-lg font-black leading-none ${config.text}`}>{Math.round(score)}</span>
      <span className={`text-[8px] font-semibold leading-none mt-0.5 ${config.text}`}>/100</span>
    </div>
  )
}

function MiniBar({ value, color, max = 100 }: { value: number; color: string; max?: number }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-semibold text-gray-600 w-8 text-right">{value.toFixed(0)}%</span>
    </div>
  )
}

export default function ScoreIAPage() {
  const [scores, setScores]         = useState<ScoreEntry[]>([])
  const [loading, setLoading]       = useState(true)
  const [calculating, setCalc]      = useState(false)
  const [search, setSearch]         = useState('')
  const [filter, setFilter]         = useState<'all' | 'critical' | 'medium' | 'good'>('all')
  const [lastCalc, setLastCalc]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/score-ia').then(r => r.json())
      const arr = Array.isArray(data) ? data : []
      setScores(arr)
      if (arr.length > 0) setLastCalc(arr[0].calculatedAt)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const calculate = async () => {
    setCalc(true)
    try {
      const res = await fetch('/api/score-ia/calculate', { method: 'POST' })
      const data = await res.json()
      if (data.calculated > 0) await load()
    } catch {}
    setCalc(false)
  }

  const filtered = scores
    .filter(s => {
      if (search) {
        return s.driverName.toLowerCase().includes(search.toLowerCase())
      }
      return true
    })
    .filter(s => {
      if (filter === 'critical') return s.score < 60
      if (filter === 'medium')   return s.score >= 60 && s.score < 80
      if (filter === 'good')     return s.score >= 80
      return true
    })
    .sort((a, b) => a.score - b.score) // worst first

  const avg      = scores.length ? scores.reduce((s, x) => s + x.score, 0) / scores.length : 0
  const critical = scores.filter(s => s.score < 60).length
  const medium   = scores.filter(s => s.score >= 60 && s.score < 80).length
  const good     = scores.filter(s => s.score >= 80).length

  return (
    <div className="flex flex-col h-full bg-gray-50">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-3 md:py-4">
        <div className="flex items-center justify-between mb-3 md:mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center">
              <Brain size={18} className="text-purple-600" />
            </div>
            <div>
              <h1 className="text-base lg:text-lg font-bold text-gray-900">Score IA Fiabilité</h1>
              <p className="text-xs text-gray-500">
                {scores.length} livreurs analysés
                {lastCalc && ` · Mis à jour ${new Date(lastCalc).toLocaleDateString('fr-FR')}`}
              </p>
            </div>
          </div>
          <button
            onClick={calculate}
            disabled={calculating}
            className="flex items-center gap-2 bg-purple-600 text-white px-3 lg:px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            <RefreshCw size={14} className={calculating ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{calculating ? 'Calcul...' : 'Recalculer'}</span>
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          {[
            { label: 'Score moyen', value: `${avg.toFixed(1)}`, icon: Target,    color: 'text-purple-600', bg: 'bg-purple-50' },
            { label: 'Excellents',  value: good,                icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50'  },
            { label: 'Moyens',      value: medium,              icon: TrendingUp,  color: 'text-orange-600',bg: 'bg-orange-50' },
            { label: 'Critiques',   value: critical,            icon: AlertTriangle,color:'text-red-600',   bg: 'bg-red-50'    },
          ].map(stat => (
            <div key={stat.label} className={`${stat.bg} rounded-xl p-3 flex items-center gap-2`}>
              <stat.icon size={16} className={stat.color} />
              <div>
                <p className={`text-xl font-black ${stat.color} leading-none`}>{stat.value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-2.5 flex items-center gap-2 md:gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Rechercher un livreur..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <div className="flex gap-1.5">
          {(['all','good','medium','critical'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filter === f
                  ? f === 'critical' ? 'bg-red-600 text-white'
                  : f === 'medium'   ? 'bg-orange-500 text-white'
                  : f === 'good'     ? 'bg-green-600 text-white'
                  : 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'Tous' : f === 'good' ? '✅ Excellents' : f === 'medium' ? '⚠️ Moyens' : '🔴 Critiques'}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-gray-400">{filtered.length} résultats</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-16 bg-white animate-pulse rounded-xl border border-gray-200" />
            ))}
          </div>
        ) : scores.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Brain size={40} className="text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium">Aucun score calculé</p>
            <p className="text-gray-400 text-sm mt-1 mb-4">Importez un fichier CSV puis cliquez sur Recalculer</p>
            <button
              onClick={calculate}
              disabled={calculating}
              className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
            >
              <RefreshCw size={14} className={calculating ? 'animate-spin' : ''} />
              {calculating ? 'Calcul en cours...' : 'Lancer le calcul'}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_80px_1fr_1fr_1fr_auto] gap-4 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
              {['Livreur', 'Score', 'Livraison (×0.4)', 'Academy (×0.3)', 'NO_SHOW (×0.3)', 'Recommandation'].map(h => (
                <span key={h} className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{h}</span>
              ))}
            </div>
            {filtered.map((entry, i) => (
              <div
                key={entry.id}
                className={`grid grid-cols-[1fr_80px_1fr_1fr_1fr_auto] gap-4 px-4 py-3 items-center ${
                  i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                } hover:bg-blue-50/30 transition-colors`}
              >
                {/* Name */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-gray-600">
                      {entry.driverName.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-gray-800 truncate">{entry.driverName}</span>
                </div>

                {/* Score badge */}
                <ScoreBadge score={entry.score} />

                {/* Delivery rate bar */}
                <div>
                  <MiniBar value={entry.deliveryRate} color={entry.deliveryRate >= 80 ? '#16a34a' : entry.deliveryRate >= 60 ? '#ea580c' : '#dc2626'} />
                </div>

                {/* Academy score bar */}
                <div>
                  <MiniBar value={entry.academyScore} color="#7c3aed" />
                </div>

                {/* NO_SHOW bar (inverted — lower is better) */}
                <div>
                  <MiniBar value={entry.noShowRate} color={entry.noShowRate <= 10 ? '#16a34a' : entry.noShowRate <= 20 ? '#ea580c' : '#dc2626'} />
                </div>

                {/* Recommendation */}
                <div className="w-48">
                  {entry.recommendation ? (
                    <span className={`text-[10px] font-medium px-2 py-1 rounded-lg leading-tight inline-block ${
                      entry.score < 60
                        ? 'bg-red-100 text-red-700'
                        : 'bg-orange-100 text-orange-700'
                    }`}>
                      {entry.recommendation}
                    </span>
                  ) : (
                    <span className="text-[10px] text-green-600 font-medium">✓ Aucune action requise</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
