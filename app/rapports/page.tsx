'use client'
// Rapports planifiés : envoi automatique de PDF par email.
//  • Rapport Control Tower (API back-office) : on COCHE les sous-modules à inclure (Lead Times, Créneaux, Livreurs…), une période relative
//    (hier / 7 jours / mois précédent) et un magasin optionnel → UN email avec UN PDF (une section par sous-module coché).
//    Pour des publics différents, on crée plusieurs planifications.
//  • Rapport importé (Excel) : ancien mode, conservé.
import { useState, useEffect, useCallback } from 'react'
import {
  Mail, Clock, CalendarCheck, CheckCircle2, XCircle,
  Send, Trash2, Plus, Settings2, History, ChevronDown, Loader2,
} from 'lucide-react'
import { BI_TABS } from '@/lib/bi-tabs'
import { REPORT_PERIODS, periodLabel } from '@/lib/bi-report'

interface Schedule {
  id: string
  reportId: string
  kind?: string
  name?: string | null
  sections?: string[] | null
  period?: string | null
  hub?: string | null
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
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
const sectionLabel = (k: string) => BI_TABS.find(t => t.key === k)?.label ?? k
const field = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400'

export default function RapportsPage() {
  const [schedules, setSchedules]   = useState<Schedule[]>([])
  const [reports, setReports]       = useState<Report[]>([])
  const [hubs, setHubs]             = useState<string[]>([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [sending, setSending]       = useState<string | null>(null)
  const [notice, setNotice]         = useState<{ ok: boolean; text: string } | null>(null)
  const [expanded, setExpanded]     = useState<string | null>(null)
  const [formError, setFormError]   = useState<string | null>(null)

  const [form, setForm] = useState({
    kind: 'bi' as 'bi' | 'legacy',
    name: '', sections: ['overview'] as string[], period: 'yesterday', hub: '',
    reportId: '', emails: '', frequency: 'daily', time: '07:30',
    dayOfWeek: 1, dayOfMonth: 1,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sRes, rRes, hRes] = await Promise.all([
        fetch('/api/dashboard/schedule-report'),
        fetch('/api/dashboard/reports'),
        fetch('/api/ops/hubs'),
      ])
      if (sRes.ok) setSchedules(await sRes.json())
      if (rRes.ok) setReports(await rRes.json())
      if (hRes.ok) setHubs(((await hRes.json()).hubs as { name: string }[]).map(h => h.name).sort())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleSection = (k: string) => setForm(f => ({ ...f, sections: f.sections.includes(k) ? f.sections.filter(x => x !== k) : [...f.sections, k] }))

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const emails = form.emails.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
    if (emails.length === 0) return setFormError('Indiquez au moins un destinataire.')
    if (form.kind === 'bi' && form.sections.length === 0) return setFormError('Cochez au moins un sous-module.')
    if (form.kind === 'legacy' && !form.reportId) return setFormError('Sélectionnez un rapport.')

    const res = await fetch('/api/dashboard/schedule-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: form.kind,
        reportId: form.kind === 'legacy' ? form.reportId : undefined,
        name: form.kind === 'bi' ? form.name : undefined,
        sections: form.kind === 'bi' ? BI_TABS.map(t => t.key).filter(k => form.sections.includes(k)) : undefined,
        period: form.kind === 'bi' ? form.period : undefined,
        hub: form.kind === 'bi' ? form.hub || null : undefined,
        emails, frequency: form.frequency, time: form.time,
        dayOfWeek:  form.frequency === 'weekly'  ? form.dayOfWeek  : null,
        dayOfMonth: form.frequency === 'monthly' ? form.dayOfMonth : null,
      }),
    })
    if (res.ok) { setShowForm(false); load() }
    else setFormError((await res.json().catch(() => ({}))).error ?? 'Création impossible.')
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    await fetch(`/api/dashboard/schedule-report?id=${id}`, { method: 'DELETE' })
    setDeleting(null)
    load()
  }

  async function handleSendNow(s: Schedule) {
    if (!window.confirm(`Envoyer maintenant ce rapport à ${s.emails.length} destinataire(s) ?\n${s.emails.join(', ')}`)) return
    setSending(s.id); setNotice(null)
    try {
      const res = await fetch(`/api/dashboard/schedule-report/send-now?id=${s.id}`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      setNotice(res.ok && j.success ? { ok: true, text: 'Rapport envoyé.' } : { ok: false, text: j.error ?? 'Envoi en échec.' })
    } finally { setSending(null); load() }
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
            <Mail className="h-5 w-5 lg:h-6 lg:w-6 text-blue-600" /> Rapports planifiés
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">Choisissez les sous-modules du Dashboard à envoyer automatiquement par email, en PDF</p>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setFormError(null) }}
          className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 lg:px-4 rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]"
        >
          <Plus size={16} /> <span className="hidden sm:inline">Nouvelle planification</span><span className="sm:hidden">Nouveau</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        {[
          { label: 'Planifications actives', value: schedules.length, icon: <Settings2 className="h-5 w-5 text-blue-500" /> },
          { label: 'Rapports envoyés', value: totalSent, icon: <Send className="h-5 w-5 text-green-500" /> },
          { label: 'Succès', value: totalOk, icon: <CheckCircle2 className="h-5 w-5 text-green-500" /> },
          { label: 'Échecs', value: totalFail, icon: <XCircle className="h-5 w-5 text-red-500" /> },
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

      {notice && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium border ${notice.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {notice.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {notice.text}
        </div>
      )}

      {lastSent && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium border ${lastSent.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {lastSent.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          Dernier envoi : {new Date(lastSent.sentAt).toLocaleString('fr-FR')}
          {' — '}
          {lastSent.success ? `Succès (${lastSent.emails.join(', ')})` : `Échec : ${lastSent.error ?? 'erreur inconnue'}`}
        </div>
      )}

      {/* New schedule form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-blue-200 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock size={16} className="text-blue-600" /> Nouvelle planification d&apos;envoi
          </h2>

          <div className="flex rounded-lg border border-gray-200 overflow-hidden mb-4 w-fit">
            {([['bi', 'Rapport Control Tower (données API)'], ['legacy', 'Rapport importé (Excel)']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setForm(f => ({ ...f, kind: k }))}
                className={`px-3 py-2 text-xs font-medium transition ${form.kind === k ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {form.kind === 'bi' ? (
              <>
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-500">Sous-modules à inclure dans le PDF</label>
                    <button type="button" className="text-xs text-blue-600 hover:underline"
                      onClick={() => setForm(f => ({ ...f, sections: f.sections.length === BI_TABS.length ? [] : BI_TABS.map(t => t.key) }))}>
                      {form.sections.length === BI_TABS.length ? 'Tout décocher' : 'Tout cocher'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {BI_TABS.map(t => (
                      <label key={t.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition ${form.sections.includes(t.key) ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        <input type="checkbox" className="mt-0.5 accent-blue-600" checked={form.sections.includes(t.key)} onChange={() => toggleSection(t.key)} />
                        <span className="font-medium">{t.label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Un seul email et un seul PDF par envoi, avec une section par sous-module coché. Pour un autre public, créez une autre planification.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Période couverte</label>
                  <select className={field} value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))}>
                    {REPORT_PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Magasin</label>
                  <select className={field} value={form.hub} onChange={e => setForm(f => ({ ...f, hub: e.target.value }))}>
                    <option value="">Tous les magasins</option>
                    {hubs.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nom du rapport (facultatif)</label>
                  <input type="text" maxLength={80} placeholder="Ex. Lead Times — suivi exploitation" className={field}
                    value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Rapport importé</label>
                <select className={field} value={form.reportId} onChange={e => setForm(f => ({ ...f, reportId: e.target.value }))}>
                  <option value="">Sélectionner un rapport…</option>
                  {reports.map(r => <option key={r.id} value={r.id}>{r.filename} ({r._count.orders} cmds)</option>)}
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Destinataires (séparés par virgule)</label>
              <input type="text" placeholder="email@example.com, autre@example.com" className={field} value={form.emails}
                onChange={e => setForm(f => ({ ...f, emails: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Fréquence</label>
              <select className={field} value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                <option value="daily">Quotidien</option><option value="weekly">Hebdomadaire</option><option value="monthly">Mensuel</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Heure d&apos;envoi (heure du Maroc)</label>
              <input type="time" className={field} value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
            </div>
            {form.frequency === 'weekly' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Jour de la semaine</label>
                <select className={field} value={form.dayOfWeek} onChange={e => setForm(f => ({ ...f, dayOfWeek: parseInt(e.target.value) }))}>
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            {form.frequency === 'monthly' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Jour du mois</label>
                <input type="number" min={1} max={28} className={field} value={form.dayOfMonth} onChange={e => setForm(f => ({ ...f, dayOfMonth: parseInt(e.target.value) }))} />
              </div>
            )}
          </div>
          {formError && <p className="mt-3 text-sm text-red-600">{formError}</p>}
          <div className="flex gap-3 mt-5">
            <button type="submit" className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">Créer la planification</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">Annuler</button>
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
              const bi = s.kind === 'bi'
              const when = `${FREQ_LABELS[s.frequency] ?? s.frequency}${s.frequency === 'weekly' && s.dayOfWeek != null ? ` (${DAYS[s.dayOfWeek]})` : ''}${s.frequency === 'monthly' && s.dayOfMonth ? ` (le ${s.dayOfMonth})` : ''} à ${s.time}`
              return (
                <div key={s.id}>
                  <div className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition" onClick={() => setExpanded(isExp ? null : s.id)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{bi ? (s.name || 'Rapport Control Tower') : 'Rapport importé (Excel)'}</span>
                        <span className="text-xs text-gray-500">{when}</span>
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{s.emails.length} destinataire{s.emails.length > 1 ? 's' : ''}</span>
                        {lastLog && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${lastLog.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {lastLog.success ? 'OK' : 'Échec'} · {new Date(lastLog.sentAt).toLocaleDateString('fr-FR')}
                          </span>
                        )}
                      </div>
                      {bi && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {(s.sections ?? []).map(k => <span key={k} className="text-[11px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">{sectionLabel(k)}</span>)}
                          <span className="text-[11px] text-gray-500">· {periodLabel(s.period)} · {s.hub || 'tous les magasins'}</span>
                        </div>
                      )}
                      <div className="text-xs text-gray-400 mt-1 truncate">{s.emails.join(' · ')}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); handleSendNow(s) }}
                        disabled={sending === s.id}
                        title="Envoyer maintenant"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-lg transition disabled:opacity-50"
                      >
                        {sending === s.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Envoyer maintenant
                      </button>
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
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mt-3 mb-2">Historique des 5 derniers envois</div>
                      {s.sendLogs.length === 0 ? (
                        <p className="text-xs text-gray-400">Aucun envoi enregistré.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {s.sendLogs.map(l => (
                            <div key={l.id} className={`flex items-center gap-3 text-xs px-3 py-2 rounded-lg border ${l.success ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                              {l.success ? <CheckCircle2 size={12} className="text-green-600 flex-shrink-0" /> : <XCircle size={12} className="text-red-600 flex-shrink-0" />}
                              <span className="text-gray-600">{new Date(l.sentAt).toLocaleString('fr-FR')}</span>
                              {l.error && <span className="text-red-600 truncate ml-auto" title={l.error}>{l.error}</span>}
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
                  {['Statut', 'Date & Heure', 'Destinataires', 'Erreur'].map(h => (
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
