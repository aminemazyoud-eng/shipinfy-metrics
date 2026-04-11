'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  Mail, Clock, CalendarCheck, CheckCircle2, XCircle,
  Send, Trash2, Plus, Settings2, History, ChevronDown,
} from 'lucide-react'

interface Schedule {
  id: string
  reportId: string
  emails: string[]
  frequency: string
  time: string
  dayOfWeek: number | null
  dayOfMonth: number | null
  isActive: boolean
  createdAt: string
  sendLogs: { id: string; sentAt: string; success: boolean; recipients: string; error: string | null }[]
}

interface Report {
  id: string
  filename: string
  uploadedAt: string
  _count: { orders: number }
}

const FREQ_LABELS: Record<string, string> = {
  daily: 'Quotidien', weekly: 'Hebdomadaire', monthly: 'Mensuel',
}

export default function RapportsPage() {
  const [schedules, setSchedules]   = useState<Schedule[]>([])
  const [reports, setReports]       = useState<Report[]>([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [expanded, setExpanded]     = useState<string | null>(null)

  const [form, setForm] = useState({
    reportId: '', emails: '', frequency: 'daily', time: '01:40',
    dayOfWeek: 1, dayOfMonth: 1,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sRes, rRes] = await Promise.all([
        fetch('/api/dashboard/schedule-report'),
        fetch('/api/dashboard/reports'),
      ])
      if (sRes.ok) setSchedules(await sRes.json())
      if (rRes.ok) setReports(await rRes.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const emails = form.emails.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
    if (!form.reportId || emails.length === 0) return

    const res = await fetch('/api/dashboard/schedule-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportId: form.reportId, emails, frequency: form.frequency, time: form.time,
        dayOfWeek:  form.frequency === 'weekly'  ? form.dayOfWeek  : null,
        dayOfMonth: form.frequency === 'monthly' ? form.dayOfMonth : null,
      }),
    })
    if (res.ok) { setShowForm(false); load() }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    await fetch(`/api/dashboard/schedule-report?id=${id}`, { method: 'DELETE' })
    setDeleting(null)
    load()
  }

  const allLogs = schedules
    .flatMap(s => s.sendLogs.map(l => ({ ...l, scheduleId: s.id, emails: s.emails })))
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())

  const totalSent  = allLogs.length
  const totalOk    = allLogs.filter(l => l.success).length
  const totalFail  = totalSent - totalOk
  const lastSent   = allLogs[0]

  return (
    <div className="flex flex-col gap-4 lg:gap-6 p-3 md:p-4 lg:p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Mail className="h-5 w-5 lg:h-6 lg:w-6 text-blue-600" /> Rapports & Planification
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">Gérez l&apos;envoi automatique des rapports PDF par email</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 lg:px-4 rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]"
        >
          <Plus size={16} /> <span className="hidden sm:inline">Nouvelle planification</span><span className="sm:hidden">Nouveau</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        {[
          { label: 'Planifications actives', value: schedules.length, icon: <Settings2 className="h-5 w-5 text-blue-500" />, color: 'blue' },
          { label: 'Rapports envoyés', value: totalSent, icon: <Send className="h-5 w-5 text-green-500" />, color: 'green' },
          { label: 'Succès', value: totalOk, icon: <CheckCircle2 className="h-5 w-5 text-green-500" />, color: 'green' },
          { label: 'Échecs', value: totalFail, icon: <XCircle className="h-5 w-5 text-red-500" />, color: 'red' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
            <div className="flex-shrink-0">{c.icon}</div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{c.value}</div>
              <div className="text-xs text-gray-500">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {lastSent && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium border ${lastSent.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {lastSent.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          Dernier envoi : {new Date(lastSent.sentAt).toLocaleString('fr-FR')}
          {' — '}
          {lastSent.success ? `✅ Succès (${lastSent.emails.join(', ')})` : `❌ Échec : ${lastSent.error ?? 'erreur inconnue'}`}
        </div>
      )}

      {/* New schedule form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-blue-200 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock size={16} className="text-blue-600" /> Nouvelle planification d&apos;envoi
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Rapport</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={form.reportId}
                onChange={e => setForm(f => ({ ...f, reportId: e.target.value }))}
                required
              >
                <option value="">Sélectionner un rapport…</option>
                {reports.map(r => (
                  <option key={r.id} value={r.id}>{r.filename} ({r._count.orders} cmds)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Destinataires (séparés par virgule)</label>
              <input
                type="text" placeholder="email@example.com, autre@example.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={form.emails}
                onChange={e => setForm(f => ({ ...f, emails: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Fréquence</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={form.frequency}
                onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
              >
                <option value="daily">Quotidien</option>
                <option value="weekly">Hebdomadaire</option>
                <option value="monthly">Mensuel</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Heure d&apos;envoi</label>
              <input
                type="time"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={form.time}
                onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
              />
            </div>
            {form.frequency === 'weekly' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Jour de la semaine</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={form.dayOfWeek}
                  onChange={e => setForm(f => ({ ...f, dayOfWeek: parseInt(e.target.value) }))}
                >
                  {['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'].map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </select>
              </div>
            )}
            {form.frequency === 'monthly' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Jour du mois</label>
                <input
                  type="number" min={1} max={28}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={form.dayOfMonth}
                  onChange={e => setForm(f => ({ ...f, dayOfMonth: parseInt(e.target.value) }))}
                />
              </div>
            )}
          </div>
          <div className="flex gap-3 mt-5">
            <button type="submit" className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
              Créer la planification
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
              Annuler
            </button>
          </div>
        </form>
      )}

      {/* Schedules list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <CalendarCheck size={16} className="text-blue-600" />
          <h2 className="font-semibold text-gray-900">Planifications actives</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Chargement…</div>
        ) : schedules.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            Aucune planification. Cliquez sur &ldquo;Nouvelle planification&rdquo; pour commencer.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {schedules.map(s => {
              const lastLog = s.sendLogs[0]
              const isExp = expanded === s.id
              return (
                <div key={s.id}>
                  <div
                    className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition"
                    onClick={() => setExpanded(isExp ? null : s.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">
                          {FREQ_LABELS[s.frequency] ?? s.frequency} à {s.time}
                        </span>
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                          {s.emails.length} destinataire{s.emails.length > 1 ? 's' : ''}
                        </span>
                        {lastLog && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${lastLog.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {lastLog.success ? '✅' : '❌'} {new Date(lastLog.sentAt).toLocaleDateString('fr-FR')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1 truncate">{s.emails.join(' · ')}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <ChevronDown size={14} className={`text-gray-400 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(s.id) }}
                        disabled={deleting === s.id}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {isExp && (
                    <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mt-3 mb-2">
                        Historique des 5 derniers envois
                      </div>
                      {s.sendLogs.length === 0 ? (
                        <p className="text-xs text-gray-400">Aucun envoi enregistré.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {s.sendLogs.map(l => (
                            <div key={l.id} className={`flex items-center gap-3 text-xs px-3 py-2 rounded-lg border ${l.success ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                              {l.success ? <CheckCircle2 size={12} className="text-green-600 flex-shrink-0" /> : <XCircle size={12} className="text-red-600 flex-shrink-0" />}
                              <span className="text-gray-600">{new Date(l.sentAt).toLocaleString('fr-FR')}</span>
                              {l.error && <span className="text-red-600 truncate ml-auto">{l.error}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Full send history */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <History size={16} className="text-blue-600" />
          <h2 className="font-semibold text-gray-900">Historique complet des envois</h2>
          <span className="ml-auto text-xs text-gray-400">{totalSent} envois au total</span>
        </div>
        {allLogs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Aucun envoi enregistré pour l&apos;instant.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Statut','Date & Heure','Destinataires','Erreur'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allLogs.slice(0, 50).map(l => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {l.success
                        ? <span className="flex items-center gap-1 text-green-700 font-medium"><CheckCircle2 size={13} /> Envoyé</span>
                        : <span className="flex items-center gap-1 text-red-600 font-medium"><XCircle size={13} /> Échec</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{new Date(l.sentAt).toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{l.emails.join(', ')}</td>
                    <td className="px-4 py-3 text-red-500 text-xs">{l.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
