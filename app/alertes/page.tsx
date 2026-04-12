'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  Bell, BellRing, AlertTriangle, Info, CheckCircle2, Clock,
  Plus, X, MessageSquare, Ticket, Settings2, RefreshCw, Zap,
  TrendingUp, ShieldAlert, Eye, Loader2,
} from 'lucide-react'

interface AlertRule {
  id: string; name: string; metric: string; operator: string
  threshold: number; severity: string; enabled: boolean
}

interface Alert {
  id: string; type: string; severity: string; title: string
  description: string; metricValue: number | null; threshold: number | null
  status: string; assignedTo: string | null; resolvedAt: string | null
  createdAt: string; rule: AlertRule | null
  tickets: { id: string; status: string }[]
}

interface Ticket {
  id: string; title: string; description: string; priority: string
  status: string; assignedTo: string | null; createdAt: string; updatedAt: string
  alert: { id: string; title: string; severity: string } | null
  comments: { id: string; author: string; content: string; createdAt: string }[]
}

const SEV_STYLE: Record<string, string> = {
  critical: 'bg-red-50 border-red-200 text-red-800',
  warning:  'bg-orange-50 border-orange-200 text-orange-800',
  info:     'bg-blue-50 border-blue-200 text-blue-800',
}
const SEV_ICON: Record<string, React.ReactNode> = {
  critical: <AlertTriangle size={15} className="text-red-500" />,
  warning:  <BellRing size={15} className="text-orange-500" />,
  info:     <Info size={15} className="text-blue-500" />,
}

const STATUS_STYLE: Record<string, string> = {
  ouvert:    'bg-red-100 text-red-700',
  en_cours:  'bg-orange-100 text-orange-700',
  resolu:    'bg-green-100 text-green-700',
  ferme:     'bg-gray-100 text-gray-600',
}
const STATUS_LABEL: Record<string, string> = {
  ouvert: 'Ouvert', en_cours: 'En cours', resolu: 'Résolu', ferme: 'Fermé',
  open: 'Ouvert', in_progress: 'En cours', resolved: 'Résolu',
}

const METRIC_LABELS: Record<string, string> = {
  delivery_rate: 'Taux de livraison', no_show_rate: 'Taux NO_SHOW',
  no_show_count: 'Nombre NO_SHOW', on_time_rate: 'Taux On-Time',
}

// ── DeliveryAlert (Sprint 7) ─────────────────────────────────────────────────
interface DeliveryAlert {
  id: string; orderId: string | null; reportId: string | null
  driverName: string | null; mode: string; level: number; type: string
  message: string; acknowledged: boolean; triggeredAt: string
  ackBy: string | null
}

const LEVEL_STYLE: Record<number, string> = {
  1: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  2: 'bg-orange-50 border-orange-200 text-orange-800',
  3: 'bg-red-50 border-red-200 text-red-800',
}
const LEVEL_LABEL: Record<number, string> = {
  1: '⚠️ Warning', 2: '🟠 Danger', 3: '🔴 Critique',
}
const TYPE_LABEL: Record<string, string> = {
  delay_risk:       'Risque retard',
  delay_confirmed:  'Retard confirmé',
  gps_blocked:      'GPS bloqué',
  predictive:       'Prévision IA',
}

export default function AlertesPage() {
  const [alerts, setAlerts]   = useState<Alert[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [rules, setRules]     = useState<AlertRule[]>([])
  const [tab, setTab]         = useState<'alertes' | 'tickets' | 'regles' | 'retards'>('alertes')
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)

  // Sprint 7 — Retards temps réel
  const [deliveryAlerts, setDeliveryAlerts] = useState<DeliveryAlert[]>([])
  const [daLoading, setDaLoading]           = useState(false)
  const [predicting, setPredicting]         = useState(false)
  const [daFilter, setDaFilter]             = useState<'all' | '1' | '2' | '3'>('all')

  // Modals
  const [newTicket, setNewTicket] = useState<{ alertId?: string; title: string; description: string; priority: string } | null>(null)
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null)
  const [comment, setComment]   = useState('')
  const [author, setAuthor]     = useState('Manager')

  // New rule form
  const [newRule, setNewRule] = useState<{ name: string; metric: string; operator: string; threshold: string; severity: string } | null>(null)

  const loadDeliveryAlerts = useCallback(async () => {
    setDaLoading(true)
    try {
      const res = await fetch('/api/alerts/delivery?ack=false&limit=100')
      if (res.ok) setDeliveryAlerts(await res.json())
    } finally {
      setDaLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [aRes, tRes, rRes] = await Promise.all([
        fetch('/api/alerts'),
        fetch('/api/tickets'),
        fetch('/api/alerts/rules'),
      ])
      if (aRes.ok) setAlerts(await aRes.json())
      if (tRes.ok) setTickets(await tRes.json())
      if (rRes.ok) setRules(await rRes.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'retards') loadDeliveryAlerts() }, [tab, loadDeliveryAlerts])

  async function handleCheck() {
    setChecking(true)
    try {
      const res = await fetch('/api/alerts/check', { method: 'POST' })
      if (res.ok) { const d = await res.json(); if (d.triggered > 0) await load() }
    } finally {
      setChecking(false)
    }
  }

  async function updateAlert(id: string, status: string) {
    await fetch('/api/alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    load()
  }

  async function createTicket() {
    if (!newTicket) return
    await fetch('/api/tickets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTicket),
    })
    setNewTicket(null); load()
  }

  async function updateTicket(id: string, status: string) {
    await fetch('/api/tickets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    load(); if (activeTicket?.id === id) setActiveTicket(null)
  }

  async function addComment() {
    if (!activeTicket || !comment.trim()) return
    await fetch(`/api/tickets/${activeTicket.id}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, content: comment }),
    })
    setComment(''); load()
  }

  async function toggleRule(id: string, enabled: boolean) {
    await fetch('/api/alerts/rules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }) })
    load()
  }

  async function createRule() {
    if (!newRule) return
    await fetch('/api/alerts/rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newRule, threshold: parseFloat(newRule.threshold) }),
    })
    setNewRule(null); load()
  }

  async function deleteRule(id: string) {
    await fetch(`/api/alerts/rules?id=${id}`, { method: 'DELETE' }); load()
  }

  // Sprint 7
  async function ackDeliveryAlert(id: string) {
    await fetch(`/api/alerts/delivery/${id}/ack`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ackBy: 'Manager' }) })
    loadDeliveryAlerts()
  }

  async function runPredict() {
    setPredicting(true)
    try {
      const res = await fetch('/api/alerts/predict', { method: 'POST' })
      const d = await res.json() as { total?: number }
      if ((d.total ?? 0) > 0) await loadDeliveryAlerts()
    } finally {
      setPredicting(false)
    }
  }

  const openAlerts    = alerts.filter(a => a.status === 'open')
  const inProg        = alerts.filter(a => a.status === 'in_progress')
  const resolved      = alerts.filter(a => a.status === 'resolved')
  const critical      = openAlerts.filter(a => a.severity === 'critical')

  const ticketsByStatus = {
    ouvert:   tickets.filter(t => t.status === 'ouvert'),
    en_cours: tickets.filter(t => t.status === 'en_cours'),
    resolu:   tickets.filter(t => t.status === 'resolu'),
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6 p-3 md:p-4 lg:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bell className="h-5 w-5 lg:h-6 lg:w-6 text-orange-500" /> Alertes & Tickets
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">Surveillance temps réel des KPIs · gestion des incidents</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="flex items-center gap-2 border border-gray-200 px-3 lg:px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition min-h-[44px]"
          >
            <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Vérifier les seuils</span>
          </button>
          <button
            onClick={() => setNewTicket({ title: '', description: '', priority: 'moyenne' })}
            className="flex items-center gap-2 bg-orange-500 text-white px-3 lg:px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition min-h-[44px]"
          >
            <Plus size={15} /> <span className="hidden sm:inline">Créer un ticket</span>
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        {[
          { label: 'Alertes critiques', value: critical.length, color: 'red',    icon: <AlertTriangle size={18} className="text-red-500" /> },
          { label: 'Alertes ouvertes',  value: openAlerts.length, color: 'orange', icon: <BellRing size={18} className="text-orange-500" /> },
          { label: 'En cours',          value: inProg.length,   color: 'blue',   icon: <Clock size={18} className="text-blue-500" /> },
          { label: 'Résolues',          value: resolved.length, color: 'green',  icon: <CheckCircle2 size={18} className="text-green-500" /> },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 lg:p-4 flex items-center gap-3">
            {c.icon}
            <div>
              <div className="text-xl lg:text-2xl font-bold text-gray-900">{c.value}</div>
              <div className="text-[10px] lg:text-xs text-gray-500">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs — scrollable on mobile */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto no-scrollbar -mx-3 px-3 md:mx-0 md:px-0">
        {[
          { key: 'alertes',  label: `🔔 Alertes (${openAlerts.length + inProg.length})` },
          { key: 'tickets',  label: `🎫 Tickets (${tickets.filter(t => t.status !== 'resolu' && t.status !== 'ferme').length})` },
          { key: 'regles',   label: '⚙️ Règles' },
          { key: 'retards',  label: `⏱️ Retards (${deliveryAlerts.filter(a => !a.acknowledged).length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`flex-shrink-0 px-3 md:px-4 py-2.5 text-sm font-medium border-b-2 transition min-h-[44px] ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ALERTES TAB ─────────────────────────────────────── */}
      {tab === 'alertes' && (
        <div className="space-y-3">
          {loading ? (
            <div className="py-12 text-center text-gray-400">Chargement…</div>
          ) : alerts.length === 0 ? (
            <div className="py-12 text-center">
              <Zap className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">Aucune alerte</p>
              <p className="text-xs text-gray-400 mt-1">Cliquez sur &ldquo;Vérifier les seuils&rdquo; pour analyser les KPIs</p>
            </div>
          ) : alerts.map(a => (
            <div key={a.id} className={`rounded-xl border p-4 ${SEV_STYLE[a.severity] ?? 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{SEV_ICON[a.severity]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{a.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </span>
                    {a.metricValue !== null && (
                      <span className="text-xs font-mono bg-white bg-opacity-60 px-2 py-0.5 rounded">
                        {a.metricValue.toFixed(1)}% (seuil : {a.threshold}%)
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-1 opacity-80">{a.description}</p>
                  <div className="text-xs opacity-60 mt-1">{new Date(a.createdAt).toLocaleString('fr-FR')}</div>
                </div>
                <div className="flex gap-2 flex-shrink-0 flex-wrap">
                  {a.status === 'open' && (
                    <button onClick={() => updateAlert(a.id, 'in_progress')} className="text-xs bg-white border border-current px-2.5 py-1 rounded-lg hover:opacity-80 transition">
                      Prendre en charge
                    </button>
                  )}
                  {a.status !== 'resolved' && (
                    <button onClick={() => updateAlert(a.id, 'resolved')} className="text-xs bg-white border border-current px-2.5 py-1 rounded-lg hover:opacity-80 transition">
                      Résoudre
                    </button>
                  )}
                  <button
                    onClick={() => setNewTicket({ alertId: a.id, title: a.title, description: a.description, priority: a.severity === 'critical' ? 'haute' : 'moyenne' })}
                    className="text-xs bg-white border border-current px-2.5 py-1 rounded-lg hover:opacity-80 transition flex items-center gap-1"
                  >
                    <Ticket size={11} /> Ticket
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TICKETS TAB ─────────────────────────────────────── */}
      {tab === 'tickets' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['ouvert', 'en_cours', 'resolu'] as const).map(status => (
            <div key={status} className="flex flex-col gap-3">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide ${STATUS_STYLE[status]}`}>
                {status === 'ouvert' ? '🔴' : status === 'en_cours' ? '🟡' : '🟢'} {STATUS_LABEL[status]} ({ticketsByStatus[status].length})
              </div>
              {ticketsByStatus[status].length === 0 ? (
                <div className="bg-gray-50 rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
                  Aucun ticket
                </div>
              ) : ticketsByStatus[status].map(ticket => (
                <div
                  key={ticket.id}
                  className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:shadow-md transition"
                  onClick={() => setActiveTicket(ticket)}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${ticket.priority === 'haute' ? 'bg-red-100 text-red-700' : ticket.priority === 'moyenne' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                      {ticket.priority === 'haute' ? '🔴 Haute' : ticket.priority === 'moyenne' ? '🟡 Moyenne' : '🔵 Basse'}
                    </span>
                    {ticket.alert && (
                      <span className="text-xs text-gray-400">Alerte</span>
                    )}
                  </div>
                  <div className="text-sm font-medium text-gray-900 mb-1">{ticket.title}</div>
                  <div className="text-xs text-gray-500 line-clamp-2">{ticket.description}</div>
                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                    <MessageSquare size={11} /> {ticket.comments.length}
                    <span className="ml-auto">{new Date(ticket.createdAt).toLocaleDateString('fr-FR')}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── RÈGLES TAB ─────────────────────────────────────── */}
      {tab === 'regles' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setNewRule({ name: '', metric: 'delivery_rate', operator: 'lt', threshold: '60', severity: 'warning' })}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              <Plus size={15} /> Nouvelle règle
            </button>
          </div>

          {newRule && (
            <div className="bg-white rounded-xl border border-blue-200 p-5 shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-4">Nouvelle règle d&apos;alerte</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500">Nom</label>
                  <input className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={newRule.name} onChange={e => setNewRule(r => r && ({ ...r, name: e.target.value }))} placeholder="ex: Taux livraison critique" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">Métrique</label>
                  <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={newRule.metric} onChange={e => setNewRule(r => r && ({ ...r, metric: e.target.value }))}>
                    {Object.entries(METRIC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">Opérateur</label>
                  <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={newRule.operator} onChange={e => setNewRule(r => r && ({ ...r, operator: e.target.value }))}>
                    <option value="lt">Inférieur à (&lt;)</option>
                    <option value="lte">Inférieur ou égal (≤)</option>
                    <option value="gt">Supérieur à (&gt;)</option>
                    <option value="gte">Supérieur ou égal (≥)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">Seuil (%)</label>
                  <input type="number" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={newRule.threshold} onChange={e => setNewRule(r => r && ({ ...r, threshold: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">Sévérité</label>
                  <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={newRule.severity} onChange={e => setNewRule(r => r && ({ ...r, severity: e.target.value }))}>
                    <option value="critical">🔴 Critique</option>
                    <option value="warning">🟡 Warning</option>
                    <option value="info">🔵 Info</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={createRule} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition">Créer</button>
                <button onClick={() => setNewRule(null)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">Annuler</button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Règle','Métrique','Condition','Sévérité','Statut','Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rules.map(r => (
                  <tr key={r.id} className={`hover:bg-gray-50 ${!r.enabled ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-3 text-gray-600">{METRIC_LABELS[r.metric] ?? r.metric}</td>
                    <td className="px-4 py-3 font-mono text-xs bg-gray-50">
                      {r.operator === 'lt' ? '<' : r.operator === 'lte' ? '≤' : r.operator === 'gt' ? '>' : '≥'} {r.threshold}%
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.severity === 'critical' ? 'bg-red-100 text-red-700' : r.severity === 'warning' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                        {r.severity === 'critical' ? '🔴 Critique' : r.severity === 'warning' ? '🟡 Warning' : '🔵 Info'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleRule(r.id, !r.enabled)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${r.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => deleteRule(r.id)} className="text-red-400 hover:text-red-600 transition p-1">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Create Ticket ──────────────────────────── */}
      {newTicket !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Créer un ticket</h3>
              <button onClick={() => setNewTicket(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500">Titre</label>
                <input className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={newTicket.title} onChange={e => setNewTicket(t => t && ({ ...t, title: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Description</label>
                <textarea rows={3} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={newTicket.description} onChange={e => setNewTicket(t => t && ({ ...t, description: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Priorité</label>
                <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" value={newTicket.priority} onChange={e => setNewTicket(t => t && ({ ...t, priority: e.target.value }))}>
                  <option value="haute">🔴 Haute</option>
                  <option value="moyenne">🟡 Moyenne</option>
                  <option value="basse">🔵 Basse</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={createTicket} className="flex-1 bg-orange-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition">Créer le ticket</button>
              <button onClick={() => setNewTicket(null)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Ticket Detail ──────────────────────────── */}
      {activeTicket && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[activeTicket.status]}`}>{STATUS_LABEL[activeTicket.status]}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${activeTicket.priority === 'haute' ? 'bg-red-100 text-red-700' : activeTicket.priority === 'moyenne' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{activeTicket.priority}</span>
                </div>
                <h3 className="font-bold text-gray-900">{activeTicket.title}</h3>
              </div>
              <button onClick={() => setActiveTicket(null)} className="text-gray-400 hover:text-gray-600 ml-4"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">{activeTicket.description}</p>

            {/* Actions */}
            <div className="flex gap-2 mb-4">
              {activeTicket.status === 'ouvert' && <button onClick={() => updateTicket(activeTicket.id, 'en_cours')} className="text-xs bg-orange-50 border border-orange-200 text-orange-700 px-3 py-1.5 rounded-lg hover:bg-orange-100 transition">Prendre en charge</button>}
              {activeTicket.status !== 'resolu' && <button onClick={() => updateTicket(activeTicket.id, 'resolu')} className="text-xs bg-green-50 border border-green-200 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-100 transition">Résoudre</button>}
            </div>

            {/* Comments */}
            <div className="flex-1 overflow-y-auto space-y-3 mb-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Commentaires ({activeTicket.comments.length})</div>
              {activeTicket.comments.map(c => (
                <div key={c.id} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-900">{c.author}</span>
                    <span className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleString('fr-FR')}</span>
                  </div>
                  <p className="text-xs text-gray-700">{c.content}</p>
                </div>
              ))}
            </div>

            {/* Add comment */}
            <div className="border-t border-gray-100 pt-4 flex gap-2">
              <input className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="Ajouter un commentaire…" value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment()} />
              <button onClick={addComment} className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition">
                <MessageSquare size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RETARDS TEMPS RÉEL TAB (Sprint 7) ──────────────────────────── */}
      {tab === 'retards' && (
        <div className="space-y-4">
          {/* Sub-header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Filtres level */}
              {[
                { key: 'all', label: 'Tous' },
                { key: '1',   label: '⚠️ Warning' },
                { key: '2',   label: '🟠 Danger' },
                { key: '3',   label: '🔴 Critique' },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setDaFilter(f.key as typeof daFilter)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition min-h-[36px] ${daFilter === f.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={loadDeliveryAlerts}
                className="flex items-center gap-2 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition min-h-[44px]"
              >
                <RefreshCw size={14} className={daLoading ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">Actualiser</span>
              </button>
              <button
                onClick={runPredict}
                disabled={predicting}
                className="flex items-center gap-2 bg-purple-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition min-h-[44px]"
              >
                {predicting ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
                <span className="hidden sm:inline">{predicting ? 'Analyse...' : 'Lancer prévision'}</span>
              </button>
            </div>
          </div>

          {daLoading ? (
            <div className="py-12 text-center text-gray-400 text-sm">Chargement…</div>
          ) : deliveryAlerts.filter(a => daFilter === 'all' || String(a.level) === daFilter).length === 0 ? (
            <div className="py-14 text-center">
              <ShieldAlert className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">Aucun retard détecté</p>
              <p className="text-xs text-gray-400 mt-1">Le moteur vérifie les créneaux toutes les 5 minutes. Cliquez sur &ldquo;Lancer prévision&rdquo; pour un check immédiat.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {deliveryAlerts
                .filter(a => daFilter === 'all' || String(a.level) === daFilter)
                .map(a => (
                  <div key={a.id} className={`rounded-xl border p-4 flex items-start gap-3 ${LEVEL_STYLE[a.level] ?? 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex-shrink-0 mt-0.5">
                      {a.level === 3 ? <AlertTriangle size={16} className="text-red-500" /> : a.level === 2 ? <BellRing size={16} className="text-orange-500" /> : <Info size={16} className="text-yellow-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-bold">{LEVEL_LABEL[a.level]}</span>
                        <span className="text-xs px-2 py-0.5 bg-white bg-opacity-60 rounded-full font-medium">{TYPE_LABEL[a.type] ?? a.type}</span>
                        {a.mode === 'express' && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">Express</span>}
                      </div>
                      <p className="text-sm font-medium leading-snug">{a.message}</p>
                      {a.driverName && (
                        <p className="text-xs mt-1 opacity-70">Livreur : {a.driverName}</p>
                      )}
                      <p className="text-xs mt-1 opacity-50">
                        {new Date(a.triggeredAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <button
                      onClick={() => ackDeliveryAlert(a.id)}
                      className="flex-shrink-0 flex items-center gap-1.5 text-xs bg-white bg-opacity-70 border border-current px-2.5 py-1.5 rounded-lg hover:bg-opacity-100 transition font-medium min-h-[36px]"
                    >
                      <Eye size={12} /> Acquitter
                    </button>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      )}
    </div>
  )
}
