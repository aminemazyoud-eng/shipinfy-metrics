'use client'
import { useState } from 'react'
import { Mail, X, Loader2, CheckCircle, Plus, Trash2, Zap, Clock, Calendar } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  reportId: string
  filters: Record<string, unknown>
  kpisData: { totalOrders?: number; [k: string]: unknown } | null
}

type Mode = 'instant' | 'scheduled'
type Frequency = 'daily' | 'weekly' | 'monthly'
type Status = 'idle' | 'loading' | 'success' | 'error'

const DAYS_OF_WEEK = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']
const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => i + 1)

function isValidEmail(e: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) }

export function SendReportModal({ open, onClose, reportId, filters, kpisData }: Props) {
  const hasData = (kpisData?.totalOrders ?? 0) > 0
  const [mode, setMode] = useState<Mode>('instant')

  const [emails, setEmails] = useState<string[]>([''])
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  const [schedEmails, setSchedEmails] = useState<string[]>([''])
  const [frequency, setFrequency] = useState<Frequency>('daily')
  const [schedTime, setSchedTime] = useState('08:00')
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [dayOfMonth, setDayOfMonth] = useState(1)
  const [schedStatus, setSchedStatus] = useState<Status>('idle')
  const [schedError, setSchedError] = useState('')

  if (!open) return null

  const addEmail = (list: string[], setList: (v: string[]) => void) =>
    setList([...list, ''])
  const removeEmail = (list: string[], setList: (v: string[]) => void, i: number) =>
    setList(list.filter((_, idx) => idx !== i))
  const updateEmail = (list: string[], setList: (v: string[]) => void, i: number, v: string) => {
    const next = [...list]; next[i] = v; setList(next)
  }

  const handleSendInstant = async () => {
    const valid = emails.filter(isValidEmail)
    if (valid.length === 0) { setError('Ajoutez au moins une adresse email valide'); return }
    setError(''); setStatus('loading')
    try {
      const res = await fetch('/api/dashboard/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, emails: valid, mode: 'instant', filters, kpisData }),
      })
      if (!res.ok) throw new Error()
      setStatus('success')
    } catch {
      setStatus('error')
      setError('Erreur envoi. Vérifiez la configuration SMTP.')
    }
  }

  const handleSaveSchedule = async () => {
    const valid = schedEmails.filter(isValidEmail)
    if (valid.length === 0) { setSchedError('Ajoutez au moins une adresse email valide'); return }
    setSchedError(''); setSchedStatus('loading')
    try {
      const res = await fetch('/api/dashboard/schedule-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId,
          emails: valid,
          frequency,
          time: schedTime,
          dayOfWeek: frequency === 'weekly' ? dayOfWeek : null,
          dayOfMonth: frequency === 'monthly' ? dayOfMonth : null,
        }),
      })
      if (!res.ok) throw new Error()
      setSchedStatus('success')
    } catch {
      setSchedStatus('error')
      setSchedError('Erreur lors de la planification.')
    }
  }

  const EmailList = ({
    list, setList, placeholder
  }: { list: string[], setList: (v: string[]) => void, placeholder?: string }) => (
    <div className="space-y-2">
      {list.map((e, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="email"
            value={e}
            onChange={ev => updateEmail(list, setList, i, ev.target.value)}
            placeholder={placeholder ?? 'email@exemple.com'}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              e && !isValidEmail(e) ? 'border-red-300 bg-red-50' : 'border-gray-300'
            }`}
          />
          {list.length > 1 && (
            <button onClick={() => removeEmail(list, setList, i)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-500 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <button onClick={() => addEmail(list, setList)}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors w-full justify-center">
        <Plus className="h-3.5 w-3.5" /> Ajouter un email
      </button>
    </div>
  )

  const reset = () => {
    setStatus('idle'); setSchedStatus('idle')
    setError(''); setSchedError('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => { if (e.target === e.currentTarget) { reset(); onClose() } }}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-900">Envoyer le rapport</h2>
          </div>
          <button onClick={() => { reset(); onClose() }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex border-b bg-gray-50">
          <button onClick={() => { setMode('instant'); reset() }}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors ${
              mode === 'instant'
                ? 'border-b-2 border-blue-600 bg-white text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Zap className="h-4 w-4" /> Envoi instantané
          </button>
          <button onClick={() => { setMode('scheduled'); reset() }}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors ${
              mode === 'scheduled'
                ? 'border-b-2 border-purple-600 bg-white text-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Clock className="h-4 w-4" /> Envoi planifié
          </button>
        </div>

        {mode === 'instant' && (
          <div className="p-6">
            {status === 'success' ? (
              <div className="flex flex-col items-center py-8 text-center">
                <CheckCircle className="mb-3 h-14 w-14 text-emerald-500" />
                <p className="text-lg font-bold text-gray-900">Rapport envoyé !</p>
                <p className="mt-1 text-sm text-gray-500">
                  Transmis à <strong>{emails.filter(isValidEmail).join(', ')}</strong>
                </p>
                <button onClick={() => { reset(); onClose() }}
                  className="mt-5 rounded-lg bg-gray-100 px-5 py-2 text-sm font-medium hover:bg-gray-200">
                  Fermer
                </button>
              </div>
            ) : (
              <>
                <p className="mb-3 text-sm font-medium text-gray-700">Destinataires</p>
                <EmailList list={emails} setList={setEmails} />

                {error && (
                  <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                    {error}
                  </p>
                )}

                {!hasData && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                    <span className="text-amber-500 text-base leading-none mt-0.5">⚠️</span>
                    <p className="text-xs font-medium text-amber-700">
                      Aucune commande dans ce rapport. Importez d&apos;abord un fichier CSV — le PDF serait vide.
                    </p>
                  </div>
                )}

                <p className="mt-4 text-xs text-gray-400">
                  Le rapport PDF complet sera envoyé immédiatement avec tous les KPIs.
                </p>

                <div className="mt-5 flex gap-3">
                  <button onClick={() => { reset(); onClose() }}
                    className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    Annuler
                  </button>
                  <button onClick={handleSendInstant} disabled={status === 'loading' || !hasData}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    {status === 'loading'
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Envoi...</>
                      : <><Zap className="h-4 w-4" /> Envoyer maintenant</>}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {mode === 'scheduled' && (
          <div className="p-6">
            {schedStatus === 'success' ? (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-purple-100">
                  <Calendar className="h-7 w-7 text-purple-600" />
                </div>
                <p className="text-lg font-bold text-gray-900">Planification enregistrée !</p>
                <p className="mt-1 text-sm text-gray-500">
                  Rapport <strong>{frequency === 'daily' ? 'quotidien' : frequency === 'weekly' ? 'hebdomadaire' : 'mensuel'}</strong> à <strong>{schedTime}</strong>
                </p>
                <p className="text-sm text-gray-400">→ {schedEmails.filter(isValidEmail).join(', ')}</p>
                <p className="mt-2 text-xs text-green-600 font-medium">Le cron job est actif — envoi automatique activé.</p>
                <button onClick={() => { reset(); onClose() }}
                  className="mt-5 rounded-lg bg-gray-100 px-5 py-2 text-sm font-medium hover:bg-gray-200">
                  Fermer
                </button>
              </div>
            ) : (
              <>
                <p className="mb-3 text-sm font-medium text-gray-700">Destinataires</p>
                <EmailList list={schedEmails} setList={setSchedEmails} />

                <p className="mb-2 mt-5 text-sm font-medium text-gray-700">Fréquence</p>
                <div className="mb-4 grid grid-cols-3 gap-2">
                  {([['daily','Quotidien','Tous les jours'],['weekly','Hebdomadaire','Chaque semaine'],['monthly','Mensuel','Chaque mois']] as const).map(([val, label, sub]) => (
                    <button key={val} onClick={() => setFrequency(val)}
                      className={`rounded-xl border p-3 text-left transition-all ${
                        frequency === val
                          ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}>
                      <p className={`text-sm font-semibold ${frequency === val ? 'text-purple-700' : 'text-gray-800'}`}>{label}</p>
                      <p className="text-xs text-gray-400">{sub}</p>
                    </button>
                  ))}
                </div>

                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Heure d&apos;envoi</label>
                    <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  </div>

                  {frequency === 'weekly' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Jour de la semaine</label>
                      <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                        {DAYS_OF_WEEK.map((d, i) => <option key={i} value={i}>{d}</option>)}
                      </select>
                    </div>
                  )}

                  {frequency === 'monthly' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Jour du mois</label>
                      <select value={dayOfMonth} onChange={e => setDayOfMonth(Number(e.target.value))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                        {DAYS_OF_MONTH.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div className="mb-4 rounded-lg bg-purple-50 px-4 py-3 text-xs text-purple-700">
                  <strong>Résumé :</strong> Rapport envoyé{' '}
                  {frequency === 'daily' && `tous les jours à ${schedTime}`}
                  {frequency === 'weekly' && `chaque ${DAYS_OF_WEEK[dayOfWeek]} à ${schedTime}`}
                  {frequency === 'monthly' && `le ${dayOfMonth} de chaque mois à ${schedTime}`}
                  {' '}→ {schedEmails.filter(isValidEmail).join(', ') || '(aucun email valide)'}
                </div>

                {schedError && (
                  <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                    {schedError}
                  </p>
                )}

                <div className="flex gap-3">
                  <button onClick={() => { reset(); onClose() }}
                    className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    Annuler
                  </button>
                  <button onClick={handleSaveSchedule} disabled={schedStatus === 'loading'}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-purple-600 py-2.5 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-50 transition-colors">
                    {schedStatus === 'loading'
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Enregistrement...</>
                      : <><Clock className="h-4 w-4" /> Planifier</>}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
