'use client'
import { useState, useEffect, useCallback } from 'react'
import { Clock, CheckCircle2, XCircle, UserCheck, Loader2, Plus, X, Download, QrCode, ScanLine, RefreshCw } from 'lucide-react'

interface Attendance {
  id: string; driverName: string; date: string; hub: string | null
  checkIn: string | null; checkOut: string | null
  status: string; role: string | null; notes: string | null
}

interface DriverLite { id: string; firstName: string; lastName: string; role: string }

const STATUS_OPTS = [
  { key: 'present', label: 'Présent',  color: 'bg-green-100 text-green-800'  },
  { key: 'late',    label: 'En retard',color: 'bg-yellow-100 text-yellow-800' },
  { key: 'absent',  label: 'Absent',   color: 'bg-red-100 text-red-800'      },
  { key: 'leave',   label: 'Congé',    color: 'bg-blue-100 text-blue-800'    },
]

const ROLE_FILTERS = [
  { key: 'all',     label: 'Tous'     },
  { key: 'LIVREUR', label: 'Livreurs' },
  { key: 'PICKER',  label: 'Pickers'  },
]

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_OPTS.find(o => o.key === status) ?? STATUS_OPTS[2]
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${s.color}`}>{s.label}</span>
}

function RoleBadge({ role }: { role: string | null }) {
  const r = role === 'PICKER' ? 'PICKER' : 'LIVREUR'
  const cls = r === 'PICKER' ? 'bg-purple-100 text-purple-800' : 'bg-teal-100 text-teal-800'
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{r === 'PICKER' ? 'Picker' : 'Livreur'}</span>
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('fr-MA', { hour: '2-digit', minute: '2-digit' })
}

function minutesWorked(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0
  const diff = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000)
  return diff > 0 ? diff : 0
}

function fmtHours(mins: number): string {
  if (mins <= 0) return '0h'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m}min`
}

function duration(checkIn: string | null, checkOut: string | null): string {
  const mins = minutesWorked(checkIn, checkOut)
  if (!checkIn || !checkOut) return '—'
  return fmtHours(mins)
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Section: Générer mon QR ──────────────────────────────────────────────────
function GenerateQrSection({ drivers }: { drivers: DriverLite[] }) {
  const [driverName, setDriverName] = useState('')
  const [role, setRole]             = useState<'LIVREUR' | 'PICKER'>('LIVREUR')
  const [loading, setLoading]       = useState(false)
  const [err, setErr]               = useState('')
  const [qr, setQr]                 = useState<{ qrDataUrl: string; pin: string; token: string } | null>(null)
  const [remainingMs, setRemainingMs] = useState(0)

  const generate = async () => {
    if (!driverName.trim()) { setErr('Nom du livreur requis'); return }
    setErr(''); setLoading(true); setQr(null)
    try {
      const res = await fetch('/api/pointage/qr-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverName: driverName.trim(), role }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Erreur'); return }
      setQr({ qrDataUrl: data.qrDataUrl, pin: data.pin, token: data.token })
      setRemainingMs(10_000)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!qr || remainingMs <= 0) return
    const started = Date.now()
    const id = setInterval(() => {
      const left = 10_000 - (Date.now() - started)
      setRemainingMs(left > 0 ? left : 0)
      if (left <= 0) clearInterval(id)
    }, 100)
    return () => clearInterval(id)
  }, [qr]) // eslint-disable-line react-hooks/exhaustive-deps

  const expired = qr && remainingMs <= 0
  const secondsLeft = Math.ceil(remainingMs / 1000)
  const pct = Math.max(0, Math.min(100, (remainingMs / 10_000) * 100))

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3">
        <QrCode size={16} className="text-teal-600" /> Générer mon QR
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Nom du livreur *</label>
          <input
            list="pointage-drivers"
            value={driverName}
            onChange={e => setDriverName(e.target.value)}
            placeholder="Prénom Nom"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          <datalist id="pointage-drivers">
            {drivers.map(d => <option key={d.id} value={`${d.firstName} ${d.lastName}`} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Rôle</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value as 'LIVREUR' | 'PICKER')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          >
            <option value="LIVREUR">Livreur</option>
            <option value="PICKER">Picker</option>
          </select>
        </div>
      </div>
      <button
        onClick={generate}
        disabled={loading}
        className="mt-3 flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
        Générer QR
      </button>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}

      {qr && (
        <div className="mt-4 flex flex-col items-center">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.qrDataUrl} alt="QR pointage" className="w-48 h-48 rounded-lg border border-gray-200" />
            {expired && (
              <button
                onClick={generate}
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 text-white rounded-lg text-xs font-semibold"
              >
                <RefreshCw size={18} />
                QR expiré — cliquez pour régénérer
              </button>
            )}
          </div>
          {!expired && (
            <>
              <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-teal-500 transition-[width] duration-100 ease-linear" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">Expire dans {secondsLeft}s</p>
            </>
          )}
          <p className="mt-2 text-lg font-mono font-bold tracking-widest text-gray-800">{qr.pin}</p>
          <p className="text-[10px] text-gray-400">Code PIN (secours)</p>
        </div>
      )}
    </div>
  )
}

// ─── Section: Scanner un QR (référent) ───────────────────────────────────────
function ScanQrSection({ onScanned }: { onScanned: () => void }) {
  // TODO caméra: html5-qrcode
  const [token, setToken]       = useState('')
  const [scannedBy, setScannedBy] = useState('')
  const [loading, setLoading]   = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const validate = async () => {
    if (!token.trim()) return
    setLoading(true); setFeedback(null)
    try {
      const res = await fetch('/api/pointage/qr-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), scannedBy: scannedBy.trim() }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        const label = data.action === 'check-out' ? '✅ Check-out réussi' : '✅ Check-in réussi'
        setFeedback({ ok: true, msg: `${label} — ${data.driverName}` })
        setToken('')
        onScanned()
      } else if (res.ok && !data.success) {
        setFeedback({ ok: false, msg: `⚠️ ${data.message ?? 'Pointage déjà complet'}` })
      } else {
        const map: Record<string, string> = {
          TOKEN_EXPIRED: '❌ QR expiré',
          TOKEN_USED:    '❌ Déjà utilisé',
          TOKEN_INVALID: '❌ Token invalide',
        }
        setFeedback({ ok: false, msg: map[data.error] ?? `❌ ${data.error ?? 'Erreur'}` })
      }
    } finally { setLoading(false) }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3">
        <ScanLine size={16} className="text-teal-600" /> Scanner un QR
      </h3>
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Coller le code QR scanné</label>
          <textarea
            value={token}
            onChange={e => setToken(e.target.value)}
            rows={2}
            placeholder="Code QR…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Référent (scannedBy)</label>
          <input
            value={scannedBy}
            onChange={e => setScannedBy(e.target.value)}
            placeholder="Nom du référent"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>
      </div>
      <button
        onClick={validate}
        disabled={loading || !token.trim()}
        className="mt-3 flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        Valider
      </button>
      {feedback && (
        <div className={`mt-3 px-3 py-2 rounded-lg text-sm font-medium ${feedback.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {feedback.msg}
        </div>
      )}
    </div>
  )
}

export default function PointagePage() {
  const today = toDateInput(new Date())
  const [date, setDate]           = useState(today)
  const [records, setRecords]     = useState<Attendance[]>([])
  const [drivers, setDrivers]     = useState<DriverLite[]>([])
  const [loading, setLoading]     = useState(false)
  const [showForm, setShowForm]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [roleFilter, setRoleFilter] = useState('all')

  // Form state
  const [fDriver, setFDriver]   = useState('')
  const [fHub, setFHub]         = useState('')
  const [fCheckIn, setFCheckIn] = useState('')
  const [fStatus, setFStatus]   = useState('present')
  const [fRole, setFRole]       = useState<'LIVREUR' | 'PICKER'>('LIVREUR')
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

  useEffect(() => {
    fetch('/api/drivers')
      .then(r => r.ok ? r.json() : [])
      .then((d: unknown) => { if (Array.isArray(d)) setDrivers(d as DriverLite[]) })
      .catch(() => {})
  }, [])

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
          role:    fRole,
          notes:   fNotes   || undefined,
        }),
      })
      setShowForm(false); setFDriver(''); setFHub(''); setFCheckIn(''); setFStatus('present'); setFRole('LIVREUR'); setFNotes('')
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

  const filtered = records.filter(r => {
    if (roleFilter === 'all') return true
    const r2 = r.role === 'PICKER' ? 'PICKER' : 'LIVREUR'
    return r2 === roleFilter
  })

  const present  = filtered.filter(r => r.status === 'present' || r.status === 'late').length
  const absent   = filtered.filter(r => r.status === 'absent').length
  const onLeave  = filtered.filter(r => r.status === 'leave').length
  const checkedOut = filtered.filter(r => r.checkOut).length

  const livreurMins = records
    .filter(r => (r.role === 'PICKER' ? 'PICKER' : 'LIVREUR') === 'LIVREUR')
    .reduce((s, r) => s + minutesWorked(r.checkIn, r.checkOut), 0)
  const pickerMins = records
    .filter(r => r.role === 'PICKER')
    .reduce((s, r) => s + minutesWorked(r.checkIn, r.checkOut), 0)

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

      {/* QR sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GenerateQrSection drivers={drivers} />
        <ScanQrSection onScanned={load} />
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

      {/* Heures par rôle */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 lg:p-4">
          <div className="text-xl lg:text-2xl font-bold text-teal-700">{fmtHours(livreurMins)}</div>
          <div className="text-[10px] lg:text-xs text-teal-600">Total heures livreurs ({date})</div>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 lg:p-4">
          <div className="text-xl lg:text-2xl font-bold text-purple-700">{fmtHours(pickerMins)}</div>
          <div className="text-[10px] lg:text-xs text-purple-600">Total heures pickers ({date})</div>
        </div>
      </div>

      {/* Role filter */}
      <div className="flex gap-1.5 flex-wrap">
        {ROLE_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setRoleFilter(f.key)}
            className={[
              'px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
              roleFilter === f.key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            ].join(' ')}
          >
            {f.label}
          </button>
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
                list="pointage-drivers-form"
                value={fDriver} onChange={e => setFDriver(e.target.value)}
                placeholder="Prénom Nom"
                className="w-full border border-teal-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              <datalist id="pointage-drivers-form">
                {drivers.map(d => <option key={d.id} value={`${d.firstName} ${d.lastName}`} />)}
              </datalist>
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
            <div>
              <label className="block text-xs text-teal-700 mb-1">Rôle</label>
              <select
                value={fRole} onChange={e => setFRole(e.target.value as 'LIVREUR' | 'PICKER')}
                className="w-full border border-teal-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
              >
                <option value="LIVREUR">Livreur</option>
                <option value="PICKER">Picker</option>
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
      ) : filtered.length === 0 ? (
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
                  {['Livreur', 'Rôle', 'Hub', 'Statut', 'Check-in', 'Check-out', 'Durée', 'Notes', ''].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 font-medium text-gray-900">{r.driverName}</td>
                    <td className="px-3 py-3"><RoleBadge role={r.role} /></td>
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
