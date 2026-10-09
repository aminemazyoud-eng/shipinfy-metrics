'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { History, Download, Lock, Loader2, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { localToday, addDays } from '@/lib/tz'

// ─── Types ────────────────────────────────────────────────────────────────────
interface DayItem { id: string; driverName: string; role: string | null; hub: string | null; status: string; checkIn: string | null; checkOut: string | null; workedMinutes: number; lateMinutes: number; plannedDepart: string | null; notes: string | null }
interface DayData { day: string; locked: boolean; summary: { present: number; late: number; absent: number; leave: number; none: number; totalMinutes: number }; items: DayItem[] }
interface MonthRow { driverName: string; hub: string | null; days: Record<string, { s: string; w: number; l: number }>; totals: { present: number; late: number; absent: number; leave: number; minutes: number; lateMinutes: number; rate: number | null } }
interface MonthData { month: string; nbDays: number; locked: boolean; payStatus: string | null; matrix: MonthRow[] }
interface Snap { status?: string; checkIn?: string | null; checkOut?: string | null; notes?: string | null }
interface Entry { id: string; at: string; actor: string | null; action: string; driverName: string | null; day: string | null; reason: string | null; override: boolean; before: Snap | null; after: Snap | null }

const STATUS: Record<string, { label: string; badge: string; dot: string; letter: string }> = {
  present: { label: 'Présent',    badge: 'bg-green-100 text-green-800',   dot: 'bg-green-500',  letter: 'P' },
  late:    { label: 'Retard',     badge: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-400', letter: 'R' },
  absent:  { label: 'Absent',     badge: 'bg-red-100 text-red-800',       dot: 'bg-red-500',    letter: 'A' },
  leave:   { label: 'Congé',      badge: 'bg-blue-100 text-blue-800',     dot: 'bg-blue-500',   letter: 'C' },
  none:    { label: 'Non pointé', badge: 'bg-gray-100 text-gray-500',     dot: 'bg-gray-300',   letter: '·' },
}
const ACTIONS: Record<string, { label: string; cls: string }> = {
  'pointage.create': { label: 'Création',     cls: 'bg-green-100 text-green-800' },
  'pointage.update': { label: 'Modification', cls: 'bg-yellow-100 text-yellow-800' },
  'pointage.delete': { label: 'Suppression',  cls: 'bg-red-100 text-red-800' },
  'pointage.qr':     { label: 'Scan QR',      cls: 'bg-teal-100 text-teal-800' },
}

const TZ = 'Africa/Casablanca'
const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—')
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const fmtHours = (m: number) => (m > 0 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : '—')
const briefSnap = (s: Snap | null) => (s ? [STATUS[s.status ?? '']?.label ?? s.status, s.checkIn ? `arr. ${fmtTime(s.checkIn)}` : null, s.checkOut ? `dép. ${fmtTime(s.checkOut)}` : null, s.notes ? `« ${s.notes} »` : null].filter(Boolean).join(' · ') : '—')

const Badge = ({ status }: { status: string }) => {
  const s = STATUS[status] ?? STATUS.none
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${s.badge}`}>{s.label}</span>
}
const LockBadge = () => (
  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
    <Lock size={12} /> Période verrouillée (paie validée)
  </span>
)
const xlsxLink = (href: string) => (
  <a href={href} download className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 min-h-[44px] border border-gray-200">
    <Download size={15} /> Excel
  </a>
)
const inputCls = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 min-h-[44px]'

// ─── Onglet Jour ──────────────────────────────────────────────────────────────
function DayTab() {
  const [day, setDay] = useState(localToday())
  const [data, setData] = useState<DayData | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/ops/pointage-history?view=day&day=${day}`)
      if (r.ok) setData(await r.json()); else { setData(null); setErr('Chargement impossible') }
    } catch { setErr('Chargement impossible') } finally { setLoading(false) }
  }, [day])
  useEffect(() => { load() }, [load])

  const s = data?.summary
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setDay(addDays(day, -1))} className="p-2 rounded-lg border border-gray-200 bg-white min-h-[44px]" aria-label="Jour précédent"><ChevronLeft size={16} /></button>
        <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className={inputCls} />
        <button onClick={() => setDay(addDays(day, 1))} className="p-2 rounded-lg border border-gray-200 bg-white min-h-[44px]" aria-label="Jour suivant"><ChevronRight size={16} /></button>
        {data?.locked && <LockBadge />}
        <div className="ml-auto">{xlsxLink(`/api/ops/pointage-history?view=day&day=${day}&format=xlsx`)}</div>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { k: 'present', v: s.present }, { k: 'late', v: s.late }, { k: 'absent', v: s.absent }, { k: 'leave', v: s.leave },
          ].map(c => (
            <div key={c.k} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${STATUS[c.k].dot}`} />
              <div><div className="text-xl font-bold text-gray-800">{c.v}</div><div className="text-xs text-gray-500">{STATUS[c.k].label}</div></div>
            </div>
          ))}
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-3">
            <div className="text-xl font-bold text-teal-700">{fmtHours(s.totalMinutes)}</div>
            <div className="text-xs text-teal-600">Heures travaillées</div>
          </div>
        </div>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}
      {loading ? (
        <div className="py-12 text-center text-gray-400"><Loader2 className="inline animate-spin" size={18} /> Chargement…</div>
      ) : data && data.items.length === 0 ? (
        <div className="py-16 text-center text-gray-400 border border-dashed border-gray-300 rounded-xl">Aucun pointage pour le {day}</div>
      ) : data && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>{['Livreur', 'Hub', 'Statut', 'Arrivée', 'Départ', 'Heures', 'Retard', 'Départ prévu', 'Note'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map(i => (
                  <tr key={i.id} className={i.status === 'late' ? 'bg-yellow-50/50' : i.status === 'absent' ? 'bg-red-50/50' : i.status === 'leave' ? 'bg-blue-50/50' : ''}>
                    <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{i.driverName}</td>
                    <td className="px-3 py-2.5 text-gray-500">{i.hub ?? '—'}</td>
                    <td className="px-3 py-2.5"><Badge status={i.status} /></td>
                    <td className="px-3 py-2.5 text-gray-600">{fmtTime(i.checkIn)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{fmtTime(i.checkOut)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{fmtHours(i.workedMinutes)}</td>
                    <td className={`px-3 py-2.5 ${i.lateMinutes > 0 ? 'text-yellow-700 font-semibold' : 'text-gray-400'}`}>{i.lateMinutes > 0 ? `${i.lateMinutes} min` : '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{i.plannedDepart ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-400 max-w-[180px] truncate">{i.notes ?? '—'}</td>
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

// ─── Onglet Mois ──────────────────────────────────────────────────────────────
function MonthTab() {
  const [month, setMonth] = useState(localToday().slice(0, 7))
  const [data, setData] = useState<MonthData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/ops/pointage-history?view=month&month=${month}`)
      setData(r.ok ? await r.json() : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [month])
  useEffect(() => { load() }, [load])

  const shift = (n: number) => setMonth(addDays(`${month}-15`, n * 30).slice(0, 7))
  const days = data ? Array.from({ length: data.nbDays }, (_, i) => i + 1) : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => shift(-1)} className="p-2 rounded-lg border border-gray-200 bg-white min-h-[44px]" aria-label="Mois précédent"><ChevronLeft size={16} /></button>
        <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className={inputCls} />
        <button onClick={() => shift(1)} className="p-2 rounded-lg border border-gray-200 bg-white min-h-[44px]" aria-label="Mois suivant"><ChevronRight size={16} /></button>
        {data?.locked && <LockBadge />}
        <div className="ml-auto">{xlsxLink(`/api/ops/pointage-history?view=month&month=${month}&format=xlsx`)}</div>
      </div>
      <div className="flex gap-3 flex-wrap text-xs text-gray-600">
        {['present', 'late', 'absent', 'leave'].map(k => <span key={k} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded-full ${STATUS[k].dot}`} />{STATUS[k].label}</span>)}
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400"><Loader2 className="inline animate-spin" size={18} /> Chargement…</div>
      ) : !data || data.matrix.length === 0 ? (
        <div className="py-16 text-center text-gray-400 border border-dashed border-gray-300 rounded-xl">Aucun pointage pour {month}</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium text-gray-500 min-w-[140px]">Livreur</th>
                  {days.map(d => <th key={d} className="px-0.5 py-2 text-center font-medium text-gray-500 w-6 min-w-[24px]">{d}</th>)}
                  {['Présents', 'Retards', 'Absences', 'Congés', 'Heures', 'Taux'].map(h => <th key={h} className="px-2 py-2 text-center font-medium text-gray-500 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.matrix.map(r => (
                  <tr key={r.driverName}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.driverName}</td>
                    {days.map(d => {
                      const c = r.days[String(d)]
                      return (
                        <td key={d} className="px-0.5 py-2 text-center">
                          {c ? <span title={`${STATUS[c.s]?.label ?? c.s}${c.w ? ' · ' + fmtHours(c.w) : ''}${c.l ? ' · retard ' + c.l + ' min' : ''}`} className={`inline-block w-4 h-4 rounded-full ${STATUS[c.s]?.dot ?? 'bg-gray-300'}`} /> : <span className="text-gray-200">·</span>}
                        </td>
                      )
                    })}
                    <td className="px-2 py-2 text-center font-semibold text-green-700">{r.totals.present}</td>
                    <td className="px-2 py-2 text-center text-yellow-700">{r.totals.late}</td>
                    <td className="px-2 py-2 text-center text-red-700">{r.totals.absent}</td>
                    <td className="px-2 py-2 text-center text-blue-700">{r.totals.leave}</td>
                    <td className="px-2 py-2 text-center text-gray-700 whitespace-nowrap">{fmtHours(r.totals.minutes)}</td>
                    <td className="px-2 py-2 text-center font-semibold text-gray-800">{r.totals.rate === null ? '—' : `${r.totals.rate}%`}</td>
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

// ─── Onglet Historique des corrections ────────────────────────────────────────
function HistoryTab() {
  const today = localToday()
  const [driver, setDriver] = useState('')
  const [from, setFrom] = useState(addDays(today, -30))
  const [to, setTo] = useState(today)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)

  const qs = `driver=${encodeURIComponent(driver.trim())}&from=${from}&to=${to}`
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/ops/pointage-history?view=history&${qs}`)
      setEntries(r.ok ? (await r.json()).entries : [])
    } catch { setEntries([]) } finally { setLoading(false) }
  }, [qs])
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t) }, [load])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2 flex-wrap">
        <div><label className="block text-xs text-gray-500 mb-1">Livreur</label>
          <input value={driver} onChange={e => setDriver(e.target.value)} placeholder="Nom…" className={`${inputCls} w-full sm:w-48`} /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Du</label>
          <input type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} className={inputCls} /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Au</label>
          <input type="date" value={to} onChange={e => e.target.value && setTo(e.target.value)} className={inputCls} /></div>
        <div className="ml-auto">{xlsxLink(`/api/ops/pointage-history?view=history&${qs}&format=xlsx`)}</div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400"><Loader2 className="inline animate-spin" size={18} /> Chargement…</div>
      ) : entries.length === 0 ? (
        <div className="py-16 text-center text-gray-400 border border-dashed border-gray-300 rounded-xl">Aucune correction sur la période</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>{['Quand', 'Par', 'Action', 'Livreur', 'Jour', 'Motif', 'Avant → Après'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map(e => {
                  const a = ACTIONS[e.action] ?? { label: e.action, cls: 'bg-gray-100 text-gray-700' }
                  return (
                    <tr key={e.id} className="align-top">
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDateTime(e.at)}</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{e.actor ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${a.cls}`}>{a.label}</span>
                        {e.override && <span className="ml-1 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">dérogation</span>}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{e.driverName ?? '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{e.day ?? '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600 min-w-[140px]">{e.reason ?? '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600 min-w-[240px]">
                        <div className="text-gray-400">{briefSnap(e.before)}</div>
                        <div>→ {briefSnap(e.after)}</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const TABS = [{ key: 'day', label: 'Jour' }, { key: 'month', label: 'Mois' }, { key: 'history', label: 'Historique des corrections' }] as const

export default function PointageHistoryPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('day')
  return (
    <div className="flex flex-col gap-4 lg:gap-6 p-3 md:p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <History className="h-5 w-5 lg:h-6 lg:w-6 text-teal-600" /> Pointage — historique
          </h1>
          <p className="text-xs lg:text-sm text-gray-500 mt-1">Consultation par jour et par mois, avec le journal de toutes les corrections</p>
        </div>
        <Link href="/pointage" className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 min-h-[44px] border border-gray-200">
          <ArrowLeft size={15} /> Saisie du pointage
        </Link>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={['px-4 py-2 rounded-xl text-sm font-semibold transition-colors min-h-[44px]', tab === t.key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'].join(' ')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'day' && <DayTab />}
      {tab === 'month' && <MonthTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  )
}
