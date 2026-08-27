'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Bell, Mail, MessageSquare, Smartphone, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, Send, FileText, Clock, Loader2,
} from 'lucide-react'

type Channel = 'email' | 'slack' | 'whatsapp'

interface ChannelResult {
  channel: Channel
  status:  'delivered' | 'failed' | 'skipped'
  sentTo?: string
  error?:  string
  at:      string
}

interface NotifItem {
  id:          string
  kind:        'report' | 'alert'
  event:       string
  title:       string
  summary:     string
  recipients:  string | null
  channels:    Channel[]
  results:     ChannelResult[]
  status:      string
  mode:        'direct' | 'n8n'
  pdfFilename: string | null
  alertLevel:  number | null
  createdAt:   string
}

interface Stats {
  total: number; today: number; delivered: number; failed: number
  successRate: number; reports: number; alerts: number
}

const CHANNEL_ICON: Record<Channel, typeof Mail> = {
  email: Mail, slack: MessageSquare, whatsapp: Smartphone,
}

const STATUS_STYLE: Record<string, string> = {
  delivered:   'bg-green-100 text-green-700',
  sent_to_n8n: 'bg-blue-100 text-blue-700',
  partial:     'bg-amber-100 text-amber-700',
  pending:     'bg-gray-100 text-gray-600',
  failed:      'bg-red-100 text-red-700',
}

const STATUS_LABEL: Record<string, string> = {
  delivered: 'Envoyé', sent_to_n8n: 'Délégué n8n', partial: 'Partiel',
  pending: 'En cours', failed: 'Échec',
}

export default function NotificationsPage() {
  const [items, setItems]     = useState<NotifItem[]>([])
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<'report' | 'alert'>('report')
  const [retrying, setRetry]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications?days=30&limit=200')
      if (res.ok) {
        const d = await res.json()
        setItems(d.items ?? [])
        setStats(d.stats ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => items.filter(i => i.kind === tab), [items, tab])

  async function retry(id: string) {
    setRetry(id)
    try {
      await fetch(`/api/notifications/${id}/retry`, { method: 'POST' })
      await load()
    } finally {
      setRetry(null)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2.5 mb-1">
        <Bell className="text-blue-600" size={22} />
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Notifications</h1>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Journal centralisé de tous les rapports et alertes envoyés — email, Slack, WhatsApp.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard icon={Send}        label="Envoyés aujourd'hui" value={stats?.today ?? 0} tone="blue" />
        <StatCard icon={CheckCircle2} label="Taux de succès"      value={`${stats?.successRate ?? 0}%`} tone="green" />
        <StatCard icon={AlertTriangle} label="Échecs (30j)"       value={stats?.failed ?? 0} tone="red" />
        <StatCard icon={Clock}       label="Total (30j)"          value={stats?.total ?? 0} tone="gray" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <TabBtn active={tab === 'report'} onClick={() => setTab('report')} icon={FileText}
          label={`Rapports${stats ? ` (${stats.reports})` : ''}`} />
        <TabBtn active={tab === 'alert'} onClick={() => setTab('alert')} icon={AlertTriangle}
          label={`Alertes${stats ? ` (${stats.alerts})` : ''}`} />
        <button onClick={load} className="ml-auto text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1 px-2">
          <RefreshCw size={13} /> Actualiser
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          Aucun{tab === 'report' ? ' rapport' : 'e alerte'} envoyé sur les 30 derniers jours.
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-3 py-2.5 font-semibold">Date</th>
                <th className="px-3 py-2.5 font-semibold">Objet</th>
                <th className="px-3 py-2.5 font-semibold">Canaux</th>
                <th className="px-3 py-2.5 font-semibold">Destinataires</th>
                <th className="px-3 py-2.5 font-semibold">Statut</th>
                <th className="px-3 py-2.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(n => {
                const canRetry = n.status === 'failed' || n.status === 'partial'
                return (
                  <tr key={n.id} className="hover:bg-gray-50 align-top">
                    <td className="px-3 py-3 whitespace-nowrap text-gray-500 text-xs">
                      {new Date(n.createdAt).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-3 max-w-xs">
                      <div className="font-medium text-gray-900 truncate">{n.title}</div>
                      <div className="text-xs text-gray-500 line-clamp-2">{n.summary}</div>
                      {n.pdfFilename && (
                        <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                          <FileText size={11} /> {n.pdfFilename}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1.5">
                        {n.channels.map(ch => {
                          const Icon = CHANNEL_ICON[ch]
                          const res  = n.results.find(r => r.channel === ch)
                          const tone = !res ? 'text-gray-300'
                            : res.status === 'delivered' ? 'text-green-600'
                            : res.status === 'failed' ? 'text-red-500' : 'text-gray-300'
                          return (
                            <span key={ch} title={res?.error ?? res?.status ?? 'en attente'} className={tone}>
                              <Icon size={15} />
                            </span>
                          )
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600 max-w-[180px] truncate">
                      {n.recipients ?? '—'}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[n.status] ?? STATUS_STYLE.pending}`}>
                        {STATUS_LABEL[n.status] ?? n.status}
                      </span>
                      {n.mode === 'n8n' && (
                        <span className="ml-1 text-[10px] text-blue-400">via n8n</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {canRetry && (
                        <button
                          onClick={() => retry(n.id)}
                          disabled={retrying === n.id}
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-50"
                        >
                          {retrying === n.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <RefreshCw size={12} />}
                          Renvoyer
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-4">
        Mode d&apos;envoi : défini par la variable <code className="bg-gray-100 px-1 rounded">NOTIFY_MODE</code>{' '}
        (<code className="bg-gray-100 px-1 rounded">direct</code> = l&apos;app envoie ·{' '}
        <code className="bg-gray-100 px-1 rounded">n8n</code> = délégué à n8n, résultats renvoyés via webhook).
      </p>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, tone }: {
  icon: typeof Mail; label: string; value: string | number
  tone: 'blue' | 'green' | 'red' | 'gray'
}) {
  const tones = {
    blue: 'text-blue-600 bg-blue-50', green: 'text-green-600 bg-green-50',
    red: 'text-red-600 bg-red-50', gray: 'text-gray-600 bg-gray-100',
  }
  return (
    <div className="border border-gray-200 rounded-xl p-3.5">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${tones[tone]}`}>
        <Icon size={16} />
      </div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}

function TabBtn({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: typeof Mail; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  )
}
