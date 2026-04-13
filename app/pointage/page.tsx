'use client'
import { useState, useEffect, useCallback } from 'react'
import { Clock, CheckCircle2, XCircle, UserCheck, Loader2, Plus, X, Download } from 'lucide-react'

interface Attendance {
  id: string; driverName: string; date: string; hub: string | null
  checkIn: string | null; checkOut: string | null
  status: string; notes: string | null
}

const STATUS_OPTS = [
  { key: 'present', label: 'Présent',  color: 'bg-green-100 text-green-800'  },
  { key: 'late',    label: 'En retard',color: 'bg-yellow-100 text-yellow-800' },
  { key: 'absent',  label: 'Absent',   color: 'bg-red-100 text-red-800'      },
  { key: 'leave',   label: 'Congé',    color: 'bg-blue-100 text-blue-800'    },
]

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_OPTS.find(o => o.key === status) ?? STATUS_OPTS[2]
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${s.color}`}>{s.label}</span>
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('fr-MA', { hour: '2-digit', minute: '2-digit' })
}

function duration(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn || !checkOut) return '—'
  const diff = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000)
  if (diff < 0) return '—'
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return h > 0 ? `${h}h${m > 0 ? m + 'min' : ''}` : `${m}min`
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function PointagePage() {
  const today = toDateInput(new Date())
  const [date, setDate]           = useState(today)
  const [records, setRecords]     = useState<Attendance[]>([])
  const [loading, setLoading]     = useState(false)
  const [showForm, setShowForm]   = useState(false)
  const [saving, setSaving]       = useState(false)

  // Form state
  const [fDriver, setFDriver]   = useState('')
  const [fHub, setFHub]         = useState('')
  const [fCheckIn, setFCheckIn] = useState('')
  const [fStatus, setFStatus]   = useState('present')
  const [fNotes, setFNotes]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/pointage?date=${date}`)
      if (res.ok) setRecords(await res.json())
      else setRecords([])
    } finally { setLoading(false) }
  }, [date])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!fDriver) return
    setSaving(true)
    try {
      const checkInIso = fCheckIn ? `${date}T${fCheckIn}:00.000Z` : undefined
      await fetch('/api/pointage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverName: fDriver, date,
          hub:     fHub     || undefined,
          checkIn: checkInIso,
          status:  fStatus,
          notes:   fNotes   || undefined,
        }),
      })
      setShowForm(false); setFDriver(''); setFHub(''); setFCheckIn(''); setFStatus('present'); setFNotes('')
      await load()
    } finally { setSaving(false) }
  }

  const checkout = async (record: Attendance) => {
    const now = new Date().toISOString()
    await fetch(`/api/pointage/${record.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkOut: now }),
    })
    await load()
  }

  const present  = records.filter(r => r.status === 'present' || r.status === 'late').length
  const absent   = records.filter(r => r.status === 'absent').length
  const onLeave  = records.filter(r => r.status === 'leave').length
  const checkedOut = records.filter(r => r.checkOut).length

  return (
    <div className="flex flex-col gap-4 lg:gap-6 p-3 md:p-4 lg:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="h-5 w-5 lg:h-6 lg:w-6 text-teal-600" /> Pointage Livreurs
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1 hidden md:block">
            Gestion des présences et horaires journaliers
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="date" value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          <a
            href={`/api/pointage/export?month=${currentMonth()}`}
            download
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 min-h-[44px] border border-gray-200"
          >
            <Download size={15} /> Rapport mensuel CSV
          </a>
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 min-h-[44px]"
          >
            <Plus size={15} /> Pointer
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Présents',   value: present,    icon: <CheckCircle2 size={18} className="text-green-500" />,  color: 'text-green-700'  },
          { label: 'Absents',    value: absent,     icon: <XCircle size={18} className="text-red-500" />,         color: 'text-red-700'    },
          { label: 'Congés',     value: onLeave,    icon: <UserCheck size={18} className="text-blue-500" />,      color: 'text-blue-700'   },
          { label: 'Check-out',  value: checkedOut, icon: <Clock size={18} className="text-gray-400" />,          color: 'text-gray-700'   },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 lg:p-4 flex items-center gap-3">
            {c.icon}
            <div>
              <div className={`text-xl lg:text-2xl font-bold ${c.color}`}>{c.value}</div>
              <div className="text-[10px] lg:text-xs text-gray-500">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-teal-800">Nouveau pointage — {date}</h3>
            <button onClick={() => setShowForm(false)}><X size={16} className="text-teal-600" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-teal-700 mb-1">Nom du livreur *</label>
              <input
                value={fDriver} onChange={e => setFDriver(e.target.value)}
                placeholder="Prénom Nom"
                className="w-full border border-teal-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
            <div>
              <label className="block text-xs text-teal-700 mb-1">Hub</label>
              <input
                value={fHub} onChange={e => setFHub(e.target.value)}
                placeholder="Hub Guéliz…"
                className="w-full border border-teal-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
            <div>
              <label className="block text-xs text-teal-700 mb-1">Heure de check-in</label>
              <input
                type="time" value={fCheckIn} onChange={e => setFCheckIn(e.target.value)}
                className="w-full border border-teal-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
            <div>
              <label className="block text-xs text-teal-700 mb-1">Statut</label>
              <select
                value={fStatus} onChange={e => setFStatus(e.target.value)}
                className="w-full border border-teal-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              >
                {STATUS_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-teal-700 mb-1">Notes</label>
              <input
                value={fNotes} onChange={e => setFNotes(e.target.value)}
                placeholder="Observation…"
                className="w-full border border-teal-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
          </div>
          <button
            onClick={save} disabled={saving || !fDriver}
            className="mt-3 flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Enregistrer
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-gray-400">Chargement…</div>
      ) : records.length === 0 ? (
        <div className="py-16 text-center text-gray-400 border border-dashed border-gray-300 rounded-xl">
          <Clock size={36} className="mx-auto mb-3 text-gray-300" />
          <p>Aucun pointage pour le {date}</p>
          <p className="text-xs mt-1">Cliquez sur <strong>Pointer</strong> pour commencer</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Livreur', 'Hub', 'Statut', 'Check-in', 'Check-out', 'Durée', 'Notes', ''].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 font-medium text-gray-900">{r.driverName}</td>
                    <td className="px-3 py-3 text-gray-500">{r.hub ?? '—'}</td>
                    <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-3 text-gray-600">{fmtTime(r.checkIn)}</td>
                    <td className="px-3 py-3 text-gray-600">{fmtTime(r.checkOut)}</td>
                    <td className="px-3 py-3 text-gray-600">{duration(r.checkIn, r.checkOut)}</td>
                    <td className="px-3 py-3 text-gray-400 max-w-[140px] truncate">{r.notes ?? '—'}</td>
                    <td className="px-3 py-3">
                      {r.checkIn && !r.checkOut && (
                        <button
                          onClick={() => checkout(r)}
                          className="px-2 py-1 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                        >
                          Check-out
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
