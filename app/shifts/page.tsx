'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  Calendar, Plus, Users, ChevronLeft, ChevronRight,
  Crown, Shield, X, Check, AlertTriangle, Clock,
  MapPin, Trash2, Settings, RefreshCw, Star,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Assignment {
  id:         string
  driverName: string
  scoreIA:    number | null
  priority:   boolean
  status:     string
}

interface ShiftSlot {
  id:          string
  zone:        string
  date:        string
  startTime:   string
  endTime:     string
  maxDrivers:  number
  minDrivers:  number
  premiumOnly: boolean
  assignments: Assignment[]
}

interface ScoreRecord {
  driverName:  string
  score:       number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const mon = new Date(d)
  mon.setDate(diff)
  mon.setHours(0, 0, 0, 0)
  return mon
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function scoreColor(s: number | null) {
  if (s === null) return 'text-gray-400'
  if (s >= 80) return 'text-green-600'
  if (s >= 60) return 'text-orange-500'
  return 'text-red-500'
}

function scoreBg(s: number | null) {
  if (s === null) return 'bg-gray-100 text-gray-500'
  if (s >= 80) return 'bg-green-100 text-green-700'
  if (s >= 60) return 'bg-orange-100 text-orange-700'
  return 'bg-red-100 text-red-600'
}

function fillStatus(assigned: number, min: number, max: number) {
  if (assigned >= max)  return { label: 'Complet',     color: 'bg-green-100 text-green-700' }
  if (assigned >= min)  return { label: 'OK',          color: 'bg-blue-100 text-blue-700'   }
  if (assigned === 0)   return { label: 'Vide',        color: 'bg-gray-100 text-gray-500'   }
  return                       { label: 'Incomplet',   color: 'bg-orange-100 text-orange-700' }
}

// ─── Create Slot Modal ────────────────────────────────────────────────────────

const ZONES_PRESET = ['Casablanca Nord', 'Casablanca Sud', 'Rabat', 'Marrakech', 'Agadir', 'Tanger', 'Fès']

function CreateSlotModal({ date, onClose, onCreated }: {
  date:      string
  onClose:   () => void
  onCreated: (slot: ShiftSlot) => void
}) {
  const [form, setForm] = useState({
    zone: '', customZone: '', date, startTime: '08:00', endTime: '14:00',
    maxDrivers: 5, minDrivers: 2, premiumOnly: false,
  })
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setErr('')
    const zone = form.zone === '__custom' ? form.customZone : form.zone
    const res = await fetch('/api/shifts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, zone }),
    })
    const data = await res.json()
    if (!res.ok) { setErr(data.error ?? 'Erreur'); setLoading(false); return }
    onCreated(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <span className="text-sm font-bold text-gray-800">Nouveau créneau — {date}</span>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200">
            <X size={14} className="text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Zone *</label>
            <select
              value={form.zone}
              onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Sélectionner…</option>
              {ZONES_PRESET.map(z => <option key={z} value={z}>{z}</option>)}
              <option value="__custom">Autre zone…</option>
            </select>
            {form.zone === '__custom' && (
              <input
                value={form.customZone}
                onChange={e => setForm(f => ({ ...f, customZone: e.target.value }))}
                className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Nom de la zone"
                required
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Début</label>
              <input type="time" value={form.startTime}
                onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fin</label>
              <input type="time" value={form.endTime}
                onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Min livreurs</label>
              <input type="number" min={1} max={20} value={form.minDrivers}
                onChange={e => setForm(f => ({ ...f, minDrivers: +e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Max livreurs</label>
              <input type="number" min={1} max={50} value={form.maxDrivers}
                onChange={e => setForm(f => ({ ...f, maxDrivers: +e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.premiumOnly}
              onChange={e => setForm(f => ({ ...f, premiumOnly: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-blue-600" />
            <span className="text-sm text-gray-700">Slot premium (Academy requis, Score IA ≥ 60)</span>
            <Crown size={13} className="text-amber-500" />
          </label>

          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Annuler</button>
            <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">
              {loading ? 'Création…' : 'Créer le créneau'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Assign Driver Modal ──────────────────────────────────────────────────────

function AssignModal({ slot, scores, onClose, onUpdated }: {
  slot:      ShiftSlot
  scores:    ScoreRecord[]
  onClose:   () => void
  onUpdated: (slot: ShiftSlot) => void
}) {
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState<string | null>(null)
  const [err, setErr]         = useState('')

  const assigned = new Set(slot.assignments.map(a => a.driverName))
  const filtered = scores
    .filter(s => s.driverName.toLowerCase().includes(search.toLowerCase()) && !assigned.has(s.driverName))
    .sort((a, b) => b.score - a.score)

  const handleAssign = async (driverName: string) => {
    setLoading(driverName); setErr('')
    const res  = await fetch(`/api/shifts/${slot.id}/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverName }),
    })
    const data = await res.json()
    setLoading(null)
    if (!res.ok) { setErr(data.error ?? 'Erreur'); return }
    onUpdated(data)
  }

  const handleUnassign = async (driverName: string) => {
    setLoading(driverName)
    const res  = await fetch(`/api/shifts/${slot.id}/assign?driverName=${encodeURIComponent(driverName)}`, { method: 'DELETE' })
    const data = await res.json()
    setLoading(null)
    if (res.ok) onUpdated(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <span className="text-sm font-bold text-gray-800">Assigner des livreurs</span>
            <p className="text-xs text-gray-400 mt-0.5">{slot.zone} — {new Date(slot.date).toLocaleDateString('fr-FR')} {slot.startTime}–{slot.endTime}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100">
            <X size={14} className="text-gray-500" />
          </button>
        </div>

        {/* Currently assigned */}
        {slot.assignments.length > 0 && (
          <div className="px-5 pt-3 pb-2">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Assignés ({slot.assignments.length}/{slot.maxDrivers})</p>
            <div className="flex flex-wrap gap-1.5">
              {slot.assignments.map(a => (
                <div key={a.id} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${a.priority ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-gray-100 text-gray-700'}`}>
                  {a.priority && <Crown size={10} className="text-amber-500" />}
                  <span>{a.driverName}</span>
                  {a.scoreIA !== null && <span className={`font-bold ${scoreColor(a.scoreIA)}`}>{Math.round(a.scoreIA)}</span>}
                  <button onClick={() => handleUnassign(a.driverName)} disabled={loading === a.driverName}
                    className="ml-0.5 text-gray-400 hover:text-red-500 transition-colors">
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search + list */}
        <div className="px-5 py-2 border-t border-gray-100">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un livreur…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {err && <p className="px-5 text-xs text-red-600">{err}</p>}

        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-1.5">
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center italic">
              {scores.length === 0 ? 'Calculez les Scores IA d\'abord (/score-ia)' : 'Aucun livreur disponible'}
            </p>
          ) : (
            filtered.map(s => (
              <div key={s.driverName} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 border border-gray-100">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{s.driverName}</p>
                  <p className="text-[10px] text-gray-400">Score IA actuel</p>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${scoreBg(s.score)}`}>
                  {s.score >= 80 && <Crown size={9} className="inline mr-0.5" />}
                  {Math.round(s.score)}
                </span>
                <button
                  onClick={() => handleAssign(s.driverName)}
                  disabled={loading === s.driverName || slot.assignments.length >= slot.maxDrivers}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  {loading === s.driverName ? '…' : 'Assigner'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Slot Card ────────────────────────────────────────────────────────────────

function SlotCard({ slot, scores, onUpdated, onDelete }: {
  slot:      ShiftSlot
  scores:    ScoreRecord[]
  onUpdated: (s: ShiftSlot) => void
  onDelete:  (id: string) => void
}) {
  const [showAssign, setShowAssign] = useState(false)
  const status = fillStatus(slot.assignments.length, slot.minDrivers, slot.maxDrivers)
  const topScore = slot.assignments.reduce((mx, a) => Math.max(mx, a.scoreIA ?? 0), 0)

  return (
    <>
      {showAssign && (
        <AssignModal
          slot={slot} scores={scores}
          onClose={() => setShowAssign(false)}
          onUpdated={s => { onUpdated(s); setShowAssign(false) }}
        />
      )}
      <div className="bg-white rounded-xl border border-gray-200 p-3 hover:shadow-sm transition-shadow">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Clock size={11} className="text-blue-500 flex-shrink-0" />
              <span className="text-xs font-bold text-gray-800">{slot.startTime}–{slot.endTime}</span>
              {slot.premiumOnly && <Crown size={11} className="text-amber-500" />}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${status.color}`}>{status.label}</span>
              <span className="text-[10px] text-gray-400">{slot.assignments.length}/{slot.maxDrivers}</span>
            </div>
          </div>
          <button onClick={() => onDelete(slot.id)} className="text-gray-200 hover:text-red-400 transition-colors flex-shrink-0">
            <Trash2 size={12} />
          </button>
        </div>

        {/* Assigned avatars */}
        {slot.assignments.length > 0 ? (
          <div className="flex flex-wrap gap-1 mb-2">
            {slot.assignments.map(a => (
              <div
                key={a.id}
                title={`${a.driverName} — Score: ${a.scoreIA !== null ? Math.round(a.scoreIA) : '?'}`}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium ${a.priority ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}
              >
                {a.priority && <Crown size={8} className="text-amber-500" />}
                <span className="truncate max-w-[80px]">{a.driverName.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-gray-300 italic mb-2">Aucun livreur</p>
        )}

        {/* Min warning */}
        {slot.assignments.length < slot.minDrivers && slot.assignments.length > 0 && (
          <div className="flex items-center gap-1 mb-2 text-[10px] text-orange-600">
            <AlertTriangle size={10} />
            <span>Min {slot.minDrivers} requis</span>
          </div>
        )}

        <button
          onClick={() => setShowAssign(true)}
          className="w-full py-1.5 bg-blue-50 text-blue-700 text-[11px] font-semibold rounded-lg hover:bg-blue-100 transition-colors flex items-center justify-center gap-1"
        >
          <Plus size={11} /> Assigner
        </button>
      </div>
    </>
  )
}

// ─── Conflict detection ───────────────────────────────────────────────────────

function detectConflicts(slots: ShiftSlot[]): string[] {
  // Find drivers assigned to 2+ slots that overlap on the same day/time
  const conflicts: string[] = []
  const byDriver = new Map<string, ShiftSlot[]>()
  for (const slot of slots) {
    for (const a of slot.assignments) {
      if (!byDriver.has(a.driverName)) byDriver.set(a.driverName, [])
      byDriver.get(a.driverName)!.push(slot)
    }
  }
  for (const [driver, driverSlots] of byDriver.entries()) {
    for (let i = 0; i < driverSlots.length; i++) {
      for (let j = i + 1; j < driverSlots.length; j++) {
        const a = driverSlots[i]
        const b = driverSlots[j]
        if (a.date.slice(0, 10) !== b.date.slice(0, 10)) continue
        // Check time overlap
        const aStart = a.startTime, aEnd = a.endTime
        const bStart = b.startTime, bEnd = b.endTime
        if (aStart < bEnd && bStart < aEnd) {
          if (!conflicts.includes(driver)) conflicts.push(driver)
        }
      }
    }
  }
  return conflicts
}

// ─── Calendar cell fill color ─────────────────────────────────────────────────

function calSlotColor(assigned: number, min: number, max: number): string {
  if (assigned >= max)  return 'bg-green-100 border-green-300 text-green-800'
  if (assigned >= min)  return 'bg-blue-50 border-blue-200 text-blue-800'
  if (assigned === 0)   return 'bg-red-50 border-red-200 text-red-700'
  return 'bg-orange-50 border-orange-200 text-orange-800'
}

// ─── Tab: Planning ────────────────────────────────────────────────────────────

type PlanView = 'list' | 'calendar'

function PlanningTab() {
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()))
  const [slots, setSlots]         = useState<ShiftSlot[]>([])
  const [scores, setScores]       = useState<ScoreRecord[]>([])
  const [loading, setLoading]     = useState(false)
  const [createDate, setCreateDate] = useState<string | null>(null)
  const [zoneFilter, setZoneFilter] = useState('all')
  const [planView, setPlanView]     = useState<PlanView>('calendar')

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const zones    = ['all', ...Array.from(new Set(slots.map(s => s.zone))).sort()]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [slotsRes, scoresRes] = await Promise.all([
        fetch(`/api/shifts?week=${fmtDate(weekStart)}`),
        fetch('/api/score-ia'),
      ])
      const [slotsData, scoresData] = await Promise.all([slotsRes.json(), scoresRes.json()])
      if (Array.isArray(slotsData))  setSlots(slotsData)
      if (Array.isArray(scoresData)) setScores(scoresData)
    } finally { setLoading(false) }
  }, [weekStart])

  useEffect(() => { load() }, [load])

  const slotsForDay = (date: Date) => {
    const d = fmtDate(date)
    return slots.filter(s => {
      const sd = s.date.slice(0, 10)
      return sd === d && (zoneFilter === 'all' || s.zone === zoneFilter)
    })
  }

  const handleSlotCreated = (slot: ShiftSlot) => {
    setSlots(prev => [...prev, slot])
    setCreateDate(null)
  }

  const handleSlotUpdated = (updated: ShiftSlot) => {
    setSlots(prev => prev.map(s => s.id === updated.id ? updated : s))
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce créneau ?')) return
    setSlots(prev => prev.filter(s => s.id !== id))
    await fetch(`/api/shifts/${id}`, { method: 'DELETE' })
  }

  // Summary
  const totalSlots    = slots.length
  const totalAssigned = slots.reduce((s, slot) => s + slot.assignments.length, 0)
  const slotsOk       = slots.filter(s => s.assignments.length >= s.minDrivers).length
  const priorityCount = slots.reduce((s, slot) => s + slot.assignments.filter(a => a.priority).length, 0)
  const conflicts     = detectConflicts(slots)

  return (
    <div className="space-y-4">
      {/* Conflict alert */}
      {conflicts.length > 0 && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
          <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-red-700">
            {conflicts.length} conflit{conflicts.length > 1 ? 's' : ''} détecté{conflicts.length > 1 ? 's' : ''} :
          </span>
          <span className="text-sm text-red-600">{conflicts.join(', ')}</span>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Créneaux semaine', value: totalSlots,    bg: 'bg-blue-50',   color: 'text-blue-700'  },
          { label: 'Livreurs assignés', value: totalAssigned, bg: 'bg-green-50',  color: 'text-green-700' },
          { label: 'Créneaux OK',       value: slotsOk,       bg: 'bg-purple-50', color: 'text-purple-700'},
          { label: 'Score ≥ 80 (⭐)',   value: priorityCount, bg: 'bg-amber-50',  color: 'text-amber-700' },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-xl p-3`}>
            <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Week navigation + zone filter + view toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2">
          <button onClick={() => setWeekStart(d => addDays(d, -7))} className="text-gray-400 hover:text-gray-700">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-gray-700 min-w-[140px] text-center">
            {weekDays[0].getDate()} {MONTHS_FR[weekDays[0].getMonth()]} — {weekDays[6].getDate()} {MONTHS_FR[weekDays[6].getMonth()]}
          </span>
          <button onClick={() => setWeekStart(d => addDays(d, 7))} className="text-gray-400 hover:text-gray-700">
            <ChevronRight size={16} />
          </button>
        </div>

        {zones.length > 1 && (
          <div className="flex gap-1.5 flex-wrap">
            {zones.map(z => (
              <button
                key={z}
                onClick={() => setZoneFilter(z)}
                className={[
                  'px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
                  zoneFilter === z ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                ].join(' ')}
              >
                {z === 'all' ? 'Toutes les zones' : z}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* View toggle */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs">
            <button
              onClick={() => setPlanView('calendar')}
              className={`px-3 py-1.5 font-medium transition flex items-center gap-1 ${planView === 'calendar' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Calendar size={12} /> Calendrier
            </button>
            <button
              onClick={() => setPlanView('list')}
              className={`px-3 py-1.5 font-medium transition flex items-center gap-1 ${planView === 'list' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Users size={12} /> Liste
            </button>
          </div>
          <button onClick={load} className="text-gray-400 hover:text-blue-600 transition-colors">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Calendar view */}
      {planView === 'calendar' && (
        <div className="overflow-x-auto">
          <div className="grid grid-cols-7 gap-1 min-w-[700px]">
            {weekDays.map((day, i) => {
              const daySlots = slotsForDay(day)
              const isToday  = fmtDate(day) === fmtDate(new Date())
              return (
                <div key={i} className="flex flex-col gap-1">
                  {/* Day header */}
                  <div className={[
                    'text-center py-2 rounded-xl text-xs font-bold',
                    isToday ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-500',
                  ].join(' ')}>
                    <div>{DAYS_FR[day.getDay()]}</div>
                    <div className={isToday ? 'text-blue-100 text-[10px]' : 'text-gray-400 text-[10px]'}>{day.getDate()}/{day.getMonth()+1}</div>
                  </div>
                  {/* Compact calendar cells */}
                  <div className="flex flex-col gap-1 min-h-[80px]">
                    {daySlots.length === 0 ? (
                      <button
                        onClick={() => setCreateDate(fmtDate(day))}
                        className="flex-1 min-h-[60px] border border-dashed border-gray-200 rounded-xl text-gray-300 hover:border-blue-400 hover:text-blue-400 hover:bg-blue-50 transition-colors text-[10px] flex flex-col items-center justify-center gap-0.5"
                      >
                        <Plus size={11} />
                        <span>Ajouter</span>
                      </button>
                    ) : (
                      <>
                        {daySlots.map(slot => {
                          const assigned = slot.assignments.length
                          const cellColor = calSlotColor(assigned, slot.minDrivers, slot.maxDrivers)
                          const hasConflict = slot.assignments.some(a => conflicts.includes(a.driverName))
                          return (
                            <div key={slot.id} className={`rounded-lg border px-2 py-1.5 text-[10px] ${cellColor} ${hasConflict ? 'ring-2 ring-red-400' : ''}`}>
                              <div className="font-bold truncate">{slot.startTime}–{slot.endTime}</div>
                              <div className="truncate text-[9px] opacity-75">{slot.zone}</div>
                              <div className="flex items-center gap-1 mt-0.5">
                                <Users size={8} />
                                <span className="font-semibold">{assigned}/{slot.maxDrivers}</span>
                                {hasConflict && <AlertTriangle size={8} className="text-red-500 ml-auto" />}
                              </div>
                            </div>
                          )
                        })}
                        <button
                          onClick={() => setCreateDate(fmtDate(day))}
                          className="w-full py-1 border border-dashed border-gray-200 rounded-lg text-gray-300 hover:border-blue-400 hover:text-blue-400 hover:bg-blue-50 transition-colors text-[10px] flex items-center justify-center gap-0.5"
                        >
                          <Plus size={9} /> Créneau
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* List view (original grid) */}
      {planView === 'list' && (
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-2 min-w-[700px]">
          {weekDays.map((day, i) => {
            const daySlots  = slotsForDay(day)
            const isToday   = fmtDate(day) === fmtDate(new Date())
            return (
              <div key={i} className="flex flex-col gap-2">
                {/* Day header */}
                <div className={[
                  'text-center py-2 rounded-xl text-xs font-bold',
                  isToday ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-500',
                ].join(' ')}>
                  <div>{DAYS_FR[day.getDay()]}</div>
                  <div className={isToday ? 'text-blue-100' : 'text-gray-400'}>{day.getDate()}</div>
                </div>

                {/* Slots */}
                <div className="flex flex-col gap-1.5">
                  {daySlots.map(slot => (
                    <SlotCard
                      key={slot.id}
                      slot={slot}
                      scores={scores}
                      onUpdated={handleSlotUpdated}
                      onDelete={handleDelete}
                    />
                  ))}
                  {/* Add slot button */}
                  <button
                    onClick={() => setCreateDate(fmtDate(day))}
                    className="w-full py-2 border border-dashed border-gray-200 rounded-xl text-gray-300 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors text-xs flex items-center justify-center gap-1"
                  >
                    <Plus size={12} /> Créneau
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      )}

      {createDate && (
        <CreateSlotModal
          date={createDate}
          onClose={() => setCreateDate(null)}
          onCreated={handleSlotCreated}
        />
      )}
    </div>
  )
}

// ─── Tab: Règles ──────────────────────────────────────────────────────────────

function ReglesTab() {
  const [slots, setSlots]   = useState<ShiftSlot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/shifts')
      .then(r => r.json())
      .then((d: unknown) => { if (Array.isArray(d)) setSlots(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Stats no_show
  const noShows = slots.reduce((s, slot) =>
    s + slot.assignments.filter(a => a.status === 'no_show').length, 0)
  const confirmed = slots.reduce((s, slot) =>
    s + slot.assignments.filter(a => a.status === 'confirmed').length, 0)
  const assigned  = slots.reduce((s, slot) =>
    s + slot.assignments.filter(a => a.status === 'assigned').length, 0)

  const handleRebalance = async () => {
    const zones = [...new Set(slots.map(s => s.zone))]
    for (const zone of zones) {
      await fetch('/api/shifts/rebalance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone, date: new Date().toISOString().slice(0, 10) }),
      })
    }
    alert('Rééquilibrage effectué pour toutes les zones aujourd\'hui.')
  }

  return (
    <div className="space-y-5">
      {/* Status breakdown */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Assignés',  value: assigned,  bg: 'bg-blue-50',   color: 'text-blue-700' },
          { label: 'Confirmés', value: confirmed, bg: 'bg-green-50',  color: 'text-green-700'},
          { label: 'No-show',   value: noShows,   bg: 'bg-red-50',    color: 'text-red-700'  },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Priorisation rules */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <Star size={12} className="text-amber-500" /> Règles de priorisation (Score IA)
        </p>
        <div className="space-y-2">
          {[
            { score: '≥ 80',  color: 'bg-green-100 text-green-700', access: 'Accès 48h à l\'avance (priorité maximum)', icon: <Crown size={12} className="text-amber-500" /> },
            { score: '60–79', color: 'bg-blue-100 text-blue-700',   access: 'Accès standard 24h à l\'avance', icon: <Shield size={12} className="text-blue-500" /> },
            { score: '< 60',  color: 'bg-red-100 text-red-600',     access: 'Accès limité 12h à l\'avance uniquement', icon: <AlertTriangle size={12} className="text-red-400" /> },
          ].map(r => (
            <div key={r.score} className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50">
              {r.icon}
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.color}`}>Score {r.score}</span>
              <span className="text-xs text-gray-600">{r.access}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Rééquilibrage */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Settings size={12} /> Algorithme équilibrage zones
        </p>
        <p className="text-xs text-gray-500 mb-3">
          Si une zone dépasse son maxDrivers, l'algorithme retire les livreurs avec le Score IA le plus bas pour garantir un revenu minimum décent aux autres.
        </p>
        <button
          onClick={handleRebalance}
          className="flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-700 border border-orange-200 rounded-xl text-sm font-semibold hover:bg-orange-100 transition-colors"
        >
          <RefreshCw size={14} /> Rééquilibrer toutes les zones (aujourd'hui)
        </button>
      </div>

      {/* Slots premium */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <Crown size={12} className="text-amber-500" /> Slots Premium (Academy obligatoire)
        </p>
        {loading ? (
          <p className="text-xs text-gray-400">Chargement…</p>
        ) : slots.filter(s => s.premiumOnly).length === 0 ? (
          <p className="text-xs text-gray-400 italic">Aucun slot premium configuré. Créez un créneau avec l'option Premium.</p>
        ) : (
          <div className="space-y-2">
            {slots.filter(s => s.premiumOnly).map(s => (
              <div key={s.id} className="flex items-center gap-2 p-2 bg-amber-50 rounded-xl border border-amber-100">
                <Crown size={12} className="text-amber-500 flex-shrink-0" />
                <span className="text-xs font-semibold text-amber-800">{s.zone}</span>
                <span className="text-xs text-amber-600">{new Date(s.date).toLocaleDateString('fr-FR')} — {s.startTime}–{s.endTime}</span>
                <span className="ml-auto text-xs text-amber-600">{s.assignments.length}/{s.maxDrivers}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'planning' | 'regles'

export default function ShiftsPage() {
  const [tab, setTab] = useState<Tab>('planning')

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-gray-900 flex items-center gap-2">
            <Calendar size={20} className="text-blue-600" />
            Shifts & Planning
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Gestion des créneaux livreurs par zone — priorisation Score IA</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[
          { key: 'planning' as Tab, label: 'Planning', icon: <Calendar size={13} /> },
          { key: 'regles'   as Tab, label: 'Règles & Config', icon: <Settings size={13} /> },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'planning' && <PlanningTab />}
      {tab === 'regles'   && <ReglesTab />}
    </div>
  )
}
