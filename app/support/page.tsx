'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  HeadphonesIcon, Plus, X, Loader2, AlertTriangle,
  CheckCircle2, Clock, Filter,
} from 'lucide-react'

interface SupportTicket {
  id: string; reference: string; category: string; priority: string
  status: string; subject: string; description: string
  clientName: string | null; clientPhone: string | null; orderRef: string | null
  assignedTo: string | null; resolvedAt: string | null
  createdAt: string; updatedAt: string
}

const CATEGORIES = [
  { key: 'livraison_manquee', label: 'Livraison manquée' },
  { key: 'retard',            label: 'Retard de livraison' },
  { key: 'reclamation_cod',   label: 'Réclamation COD' },
  { key: 'mauvais_service',   label: 'Mauvais service' },
  { key: 'autre',             label: 'Autre' },
]

const PRIORITIES = [
  { key: 'urgent',  label: 'Urgent',  color: 'bg-red-100 text-red-800'      },
  { key: 'haute',   label: 'Haute',   color: 'bg-orange-100 text-orange-800' },
  { key: 'normale', label: 'Normale', color: 'bg-blue-100 text-blue-800'    },
  { key: 'basse',   label: 'Basse',   color: 'bg-gray-100 text-gray-500'    },
]

const STATUSES = [
  { key: 'ouvert',    label: 'Ouvert',      color: 'bg-yellow-100 text-yellow-800', icon: <Clock size={11} />       },
  { key: 'en_cours',  label: 'En cours',    color: 'bg-blue-100 text-blue-800',     icon: <Loader2 size={11} />     },
  { key: 'resolu',    label: 'Résolu',      color: 'bg-green-100 text-green-800',   icon: <CheckCircle2 size={11} />},
  { key: 'ferme',     label: 'Fermé',       color: 'bg-gray-100 text-gray-500',     icon: <X size={11} />           },
]

function PriorityBadge({ p }: { p: string }) {
  const s = PRIORITIES.find(x => x.key === p) ?? PRIORITIES[2]
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${s.color}`}>{s.label}</span>
}

function StatusBadge({ s }: { s: string }) {
  const st = STATUSES.find(x => x.key === s) ?? STATUSES[0]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.color}`}>
      {st.icon} {st.label}
    </span>
  )
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-MA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function SupportPage() {
  const [tickets, setTickets]     = useState<SupportTicket[]>([])
  const [loading, setLoading]     = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [selected, setSelected]   = useState<SupportTicket | null>(null)

  // Form
  const [fCat, setFCat]           = useState('livraison_manquee')
  const [fPrio, setFPrio]         = useState('normale')
  const [fSubject, setFSubject]   = useState('')
  const [fDesc, setFDesc]         = useState('')
  const [fClient, setFClient]     = useState('')
  const [fPhone, setFPhone]       = useState('')
  const [fOrderRef, setFOrderRef] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = `/api/support${statusFilter ? `?status=${statusFilter}` : ''}`
      const res = await fetch(url)
      if (res.ok) setTickets(await res.json())
      else setTickets([])
    } finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!fSubject || !fDesc) return
    setSaving(true)
    try {
      await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: fCat, priority: fPrio,
          subject: fSubject, description: fDesc,
          clientName:  fClient  || undefined,
          clientPhone: fPhone   || undefined,
          orderRef:    fOrderRef || undefined,
        }),
      })
      setShowForm(false); setFSubject(''); setFDesc(''); setFClient(''); setFPhone(''); setFOrderRef('')
      await load()
    } finally { setSaving(false) }
  }

  const updateStatus = async (ticket: SupportTicket, status: string) => {
    await fetch(`/api/support/${ticket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        resolvedAt: status === 'resolu' ? new Date().toISOString() : (status === 'ferme' ? null : undefined),
      }),
    })
    setSelected(null)
    await load()
  }

  const counts = {
    ouvert:   tickets.filter(t => t.status === 'ouvert').length,
    en_cours: tickets.filter(t => t.status === 'en_cours').length,
    resolu:   tickets.filter(t => t.status === 'resolu').length,
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6 p-3 md:p-4 lg:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <HeadphonesIcon className="h-5 w-5 lg:h-6 lg:w-6 text-violet-600" /> Support Client
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">
            Gestion des réclamations et tickets clients
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 min-h-[44px]"
          >
            <Plus size={15} /> Nouveau ticket
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Ouverts',   value: counts.ouvert,   color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
          { label: 'En cours',  value: counts.en_cours, color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200'     },
          { label: 'Résolus',   value: counts.resolu,   color: 'text-green-700',  bg: 'bg-green-50 border-green-200'   },
        ].map(c => (
          <div key={c.label} className={`rounded-xl border p-3 lg:p-4 ${c.bg}`}>
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-gray-500">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={14} className="text-gray-400" />
        <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs">
          {[{ key: '', label: 'Tous' }, ...STATUSES].map(s => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              className={`px-3 py-2 font-medium transition ${statusFilter === s.key ? 'bg-violet-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* New ticket form */}
      {showForm && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-violet-800">Nouveau ticket support</h3>
            <button onClick={() => setShowForm(false)}><X size={16} className="text-violet-600" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-violet-700 mb-1">Catégorie</label>
              <select value={fCat} onChange={e => setFCat(e.target.value)}
                className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400">
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-violet-700 mb-1">Priorité</label>
              <select value={fPrio} onChange={e => setFPrio(e.target.value)}
                className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400">
                {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-violet-700 mb-1">Sujet *</label>
              <input value={fSubject} onChange={e => setFSubject(e.target.value)} placeholder="Décrivez brièvement le problème…"
                className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-violet-700 mb-1">Description *</label>
              <textarea value={fDesc} onChange={e => setFDesc(e.target.value)} rows={3} placeholder="Détails complets…"
                className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none" />
            </div>
            <div>
              <label className="block text-xs text-violet-700 mb-1">Nom client</label>
              <input value={fClient} onChange={e => setFClient(e.target.value)} placeholder="Nom du client"
                className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <div>
              <label className="block text-xs text-violet-700 mb-1">Téléphone</label>
              <input value={fPhone} onChange={e => setFPhone(e.target.value)} placeholder="+212 6…"
                className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <div>
              <label className="block text-xs text-violet-700 mb-1">Référence commande</label>
              <input value={fOrderRef} onChange={e => setFOrderRef(e.target.value)} placeholder="SHP-000123"
                className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
          </div>
          <button onClick={create} disabled={saving || !fSubject || !fDesc}
            className="mt-3 flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Créer le ticket
          </button>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="bg-white rounded-xl border border-violet-200 p-4 shadow-md">
          <div className="flex items-start justify-between mb-3">
            <div>
              <span className="text-xs font-mono text-gray-400">{selected.reference}</span>
              <h3 className="text-sm font-bold text-gray-900 mt-0.5">{selected.subject}</h3>
            </div>
            <button onClick={() => setSelected(null)}><X size={16} className="text-gray-400" /></button>
          </div>
          <p className="text-sm text-gray-600 mb-3">{selected.description}</p>
          <div className="flex flex-wrap gap-2 mb-3 text-xs text-gray-500">
            {selected.clientName && <span>Client : <strong>{selected.clientName}</strong></span>}
            {selected.clientPhone && <span>Tel : <strong>{selected.clientPhone}</strong></span>}
            {selected.orderRef    && <span>Commande : <strong>{selected.orderRef}</strong></span>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Changer statut :</span>
            {STATUSES.map(s => (
              <button key={s.key} onClick={() => updateStatus(selected, s.key)}
                disabled={selected.status === s.key}
                className={`px-2 py-1 text-xs rounded-lg border transition ${selected.status === s.key ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-default' : 'border-gray-200 hover:bg-gray-50'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ticket list */}
      {loading ? (
        <div className="py-12 text-center text-gray-400">Chargement…</div>
      ) : tickets.length === 0 ? (
        <div className="py-16 text-center text-gray-400 border border-dashed border-gray-300 rounded-xl">
          <HeadphonesIcon size={36} className="mx-auto mb-3 text-gray-300" />
          <p>Aucun ticket pour le moment</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => (
            <div
              key={t.id}
              onClick={() => setSelected(selected?.id === t.id ? null : t)}
              className={`bg-white rounded-xl border p-4 cursor-pointer hover:border-violet-300 transition-colors ${selected?.id === t.id ? 'border-violet-400 shadow-md' : 'border-gray-200'}`}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle size={16} className={t.priority === 'urgent' ? 'text-red-500 mt-0.5 flex-shrink-0' : 'text-gray-300 mt-0.5 flex-shrink-0'} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-mono text-gray-400">{t.reference}</span>
                    <PriorityBadge p={t.priority} />
                    <StatusBadge s={t.status} />
                    <span className="text-xs text-gray-400 ml-auto">{fmtDate(t.createdAt)}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900 truncate">{t.subject}</p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {CATEGORIES.find(c => c.key === t.category)?.label ?? t.category}
                    {t.clientName && ` — ${t.clientName}`}
                    {t.orderRef   && ` — ${t.orderRef}`}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
