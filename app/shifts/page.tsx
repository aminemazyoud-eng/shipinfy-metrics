'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Send, FileText, Save, Wand2, Copy, X, ArrowRightLeft, CheckCircle2, AlertTriangle, MessageCircle, Trash2, Phone } from 'lucide-react'
import type { ForecastResult } from '@/lib/ops-analytics'

interface Drv { code: string; name: string; phone: string | null; phoneOk: boolean; homeHub: string | null; hub: string | null; vehicle: string | null; plate: string | null; helpers: { name: string; phoneOk: boolean }[]; attendance: string | null }
interface Line { driverCode: string; hubCode: string; departTime: string; slots: string[]; note?: string | null; sentAt?: string | null; sentStatus?: string | null }
interface Data { day: string; status: string; publishedAt: string | null; publishedBy: string | null; slots: string[]; whatsapp: boolean; hubs: { code: string; name: string; city: string }[]; drivers: Drv[]; lines: Line[]; prevLines: Line[]; prevDay: string }
interface SendRes { code: string; name: string; role: string; phone: string | null; hub: string; status: 'sent' | 'failed' | 'no_phone' | 'manual'; error?: string; pdf: string; waLink?: string }
interface SendOut { whatsapp: boolean; teams: number; sent: number; failed: number; noPhone: number; manual: number; results: SendRes[] }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (day: string, n: number) => iso(new Date(Date.parse(day + 'T12:00:00Z') + n * 86_400_000))
const longDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const st = (s: string) => `${s.slice(0, 2)}h–${s.slice(3)}h`
const departFor = (slots: string[]) => { const h = Number((slots[0] ?? '09-12').slice(0, 2)); const m = h * 60 - 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
const tomorrow = () => iso(new Date(Date.now() + 86_400_000 + 3_600_000))

// Opérations → Shifts & Planning : planning JOUR PAR JOUR, sur les mêmes créneaux que le calcul des prévisions.
// Chaque équipe (chauffeur + helper) est affectée au hub du jour (éventuellement ≠ hub d'origine), avec heure de départ ; envoi du PDF par WhatsApp.
export default function PlanningPage() {
  const [day, setDay] = useState(tomorrow())
  const [data, setData] = useState<Data | null>(null)
  const [fc, setFc] = useState<ForecastResult | null>(null)
  const [lines, setLines] = useState<Record<string, Line>>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; s: string } | null>(null)
  const [out, setOut] = useState<SendOut | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const load = useCallback(async (d: string) => {
    setData(null); setFc(null); setMsg(null)
    const r = await fetch(`/api/ops/planning?day=${d}`); if (!r.ok) { setMsg({ ok: false, s: 'Chargement impossible' }); return }
    const j: Data = await r.json(); setData(j); setLines(Object.fromEntries(j.lines.map(l => [l.driverCode, l]))); setDirty(false)
    fetch(`/api/ops/forecast?day=${d}`).then(x => x.ok ? x.json() : null).then(f => f && setFc(f)).catch(() => {})
  }, [])
  useEffect(() => { load(day) }, [day, load])

  const drivers = data?.drivers ?? []
  const byCode = useMemo(() => new Map(drivers.map(d => [d.code, d])), [drivers])
  const slots = data?.slots ?? []
  const set = (code: string, patch: Partial<Line>) => { setLines(l => ({ ...l, [code]: { ...(l[code] ?? { driverCode: code, hubCode: '', departTime: departFor(slots), slots: [...slots] }), ...patch } as Line })); setDirty(true) }
  const assign = (code: string, hub: string) => set(code, { hubCode: hub })
  const remove = (code: string) => { setLines(l => { const n = { ...l }; delete n[code]; return n }); setDirty(true) }
  const toggleSlot = (code: string, s: string) => { const cur = lines[code]?.slots ?? []; set(code, { slots: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s].sort() }) }

  const prefill = () => {
    const n = { ...lines }
    for (const d of drivers) if (!n[d.code] && d.attendance !== 'leave' && d.attendance !== 'absent') { const h = d.homeHub ?? d.hub; if (h) n[d.code] = { driverCode: d.code, hubCode: h, departTime: departFor(slots), slots: [...slots] } }
    setLines(n); setDirty(true)
  }
  const copyPrev = () => { if (!data) return; setLines(Object.fromEntries(data.prevLines.filter(l => byCode.has(l.driverCode)).map(l => [l.driverCode, { ...l }]))); setDirty(true) }

  const save = async (): Promise<boolean> => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/ops/planning', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, lines: Object.values(lines).filter(l => l.hubCode) }) }); const j = await r.json()
      if (!r.ok) { setMsg({ ok: false, s: j.error || 'Erreur' }); return false }
      setMsg({ ok: true, s: `Planning enregistré — ${j.saved} équipe(s)` }); await load(day); return true
    } finally { setBusy(false) }
  }
  const send = async (codes?: string[]) => {
    const n = codes?.length ?? Object.values(lines).filter(l => l.hubCode).length
    if (!n) { setMsg({ ok: false, s: 'Aucune équipe planifiée' }); return }
    if (!window.confirm(`Envoyer le planning du ${longDay(day)} (${n} équipe(s)) en PDF aux chauffeurs et helpers ?`)) return
    if (dirty && !(await save())) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/ops/planning/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, driverCodes: codes }) }); const j = await r.json()
      if (!r.ok) { setMsg({ ok: false, s: j.error || 'Envoi impossible' }); return }
      setOut(j); await load(day)
    } finally { setBusy(false) }
  }

  // demande prévue vs équipes planifiées sur chaque créneau
  const perDriver = fc?.perDriverPerSlot ?? 3
  const teamsAt = (hub: string, slot: string) => Object.values(lines).filter(l => l.hubCode === hub && l.slots.includes(slot)).length
  const planned = Object.values(lines).filter(l => l.hubCode)
  const unplanned = drivers.filter(d => !lines[d.code]?.hubCode)
  const hubName = (c: string | null) => data?.hubs.find(h => h.code === c)?.name.replace('Marjane ', '') ?? c ?? '—'
  const sentAll = planned.length > 0 && planned.every(l => l.sentAt)
  const toResend = planned.filter(l => !l.sentAt).length

  const card = (d: Drv) => {
    const l = lines[d.code]; const away = l && d.homeHub && l.hubCode !== d.homeHub
    return (
      <div key={d.code} draggable onDragStart={e => { setDrag(d.code); e.dataTransfer.setData('text/plain', d.code) }} onDragEnd={() => { setDrag(null); setOver(null) }} className={`bg-white rounded-lg border p-2.5 shadow-sm cursor-grab active:cursor-grabbing ${drag === d.code ? 'opacity-40' : ''} ${away ? 'border-amber-300' : 'border-gray-200'}`}>
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0"><div className="text-sm font-medium text-gray-900 truncate">{d.name} <span className="text-[10px] text-gray-400 font-normal">{d.code}</span></div>
            <div className="text-[11px] text-gray-400 truncate">{d.vehicle ?? ''} {d.plate ?? ''}{d.helpers.length ? ` · + ${d.helpers.map(h => h.name).join(', ')}` : ''}</div></div>
          {l && <button onClick={() => remove(d.code)} className="p-1 text-gray-300 hover:text-red-500" title="Retirer du planning"><Trash2 className="w-3.5 h-3.5" /></button>}
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {away && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 flex items-center gap-1"><ArrowRightLeft className="w-3 h-3" />vient de {hubName(d.homeHub)}</span>}
          {(d.attendance === 'leave' || d.attendance === 'absent') && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">{d.attendance === 'leave' ? 'en congé' : 'absent'}</span>}
          {!d.phoneOk && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 flex items-center gap-1"><Phone className="w-3 h-3" />n° manquant</span>}
          {d.helpers.some(h => !h.phoneOk) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">helper sans n°</span>}
          {l?.sentAt ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{l.sentStatus === 'partial' ? 'envoi partiel' : l.sentStatus === 'manual' ? 'lien généré' : 'envoyé'}</span> : l && data?.status === 'published' ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">à (ré)envoyer</span> : null}
        </div>
        {l ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-gray-600">Départ <input type="time" value={l.departTime} onChange={e => set(d.code, { departTime: e.target.value })} className="border border-gray-300 rounded px-1 py-0.5 text-xs" />
              <select value={l.hubCode} onChange={e => assign(d.code, e.target.value)} className="ml-auto border border-gray-300 rounded px-1 py-0.5 text-xs bg-white max-w-28">{data?.hubs.map(h => <option key={h.code} value={h.code}>{h.name.replace('Marjane ', '')}</option>)}</select></div>
            <div className="flex flex-wrap gap-1">{slots.map(s => <button key={s} onClick={() => toggleSlot(d.code, s)} className={`text-[10px] px-1.5 py-0.5 rounded border ${l.slots.includes(s) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-400 border-gray-200'}`}>{st(s)}</button>)}</div>
            <input value={l.note ?? ''} onChange={e => set(d.code, { note: e.target.value })} placeholder="Consigne (optionnel)" className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs" />
            {l.sentAt !== undefined && !dirty && l.hubCode && (
              <div className="flex gap-1.5 pt-0.5">
                <a href={`/api/ops/planning/pdf?day=${day}&driver=${d.code}`} target="_blank" className="flex-1 text-center text-[11px] px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 flex items-center justify-center gap-1"><FileText className="w-3 h-3" />PDF</a>
                <button disabled={busy} onClick={() => send([d.code])} className="flex-1 text-[11px] px-2 py-1 rounded bg-green-600 text-white flex items-center justify-center gap-1 disabled:opacity-40"><MessageCircle className="w-3 h-3" />WhatsApp</button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2"><select value="" onChange={e => e.target.value && assign(d.code, e.target.value)} className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs bg-white"><option value="">Affecter à un hub…</option>{data?.hubs.map(h => <option key={h.code} value={h.code}>{h.name.replace('Marjane ', '')}{h.code === d.homeHub ? ' (hub d’origine)' : ''}</option>)}</select></div>
        )}
      </div>
    )
  }

  const col = (id: string, title: string, sub: string | undefined, count: number, children: React.ReactNode) => (
    <div key={id} onDragOver={e => { e.preventDefault(); setOver(id) }} onDragLeave={() => setOver(o => (o === id ? null : o))} onDrop={e => { e.preventDefault(); setOver(null); const c = drag ?? e.dataTransfer.getData('text/plain'); setDrag(null); if (c) (id === '__none' ? remove(c) : assign(c, id)) }}
      className={`w-64 shrink-0 rounded-xl border bg-gray-50 ${over === id ? 'border-purple-500 ring-2 ring-purple-200' : 'border-gray-200'}`}>
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between"><div><div className="text-sm font-semibold text-gray-800">{title}</div>{sub && <div className="text-[10px] text-gray-400">{sub}</div>}</div><span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white border border-gray-200">{count}</span></div>
      <div className="p-2 space-y-2 max-h-[640px] overflow-y-auto min-h-20">{children}</div>
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><CalendarDays className="w-5 h-5 text-purple-600" />Shifts & Planning</h1>
          <p className="text-sm text-gray-500">Planning jour par jour — chaque équipe (chauffeur + helper) est affectée au hub du jour, avec son heure de départ. Créneaux identiques aux prévisions.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setDay(addDays(day, -1))} className="p-2 border border-gray-300 rounded-lg bg-white"><ChevronLeft className="w-4 h-4" /></button>
          <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          <button onClick={() => setDay(addDays(day, 1))} className="p-2 border border-gray-300 rounded-lg bg-white"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => setDay(tomorrow())} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white">Demain</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="text-base font-semibold text-gray-800 capitalize mr-2">{longDay(day)}</div>
        {data && <span className={`text-xs px-2 py-1 rounded-full ${data.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{data.status === 'published' ? `Publié${data.publishedAt ? ` le ${new Date(data.publishedAt).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}${data.publishedBy ? ` par ${data.publishedBy}` : ''}` : 'Brouillon'}</span>}
        {data && data.status === 'published' && toResend > 0 && <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">{toResend} équipe(s) modifiée(s) à renvoyer</span>}
        {dirty && <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800">modifications non enregistrées</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={prefill} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"><Wand2 className="w-4 h-4" />Pré-remplir (hubs d&apos;origine)</button>
          <button onClick={copyPrev} disabled={!data?.prevLines.length} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white disabled:opacity-40" title={`Copier le planning du ${data?.prevDay ?? ''}`}><Copy className="w-4 h-4" />Copier la veille</button>
          <button onClick={save} disabled={busy || !dirty} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40"><Save className="w-4 h-4" />Enregistrer</button>
          <a href={`/api/ops/planning/pdf?day=${day}`} target="_blank" className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white ${dirty || !planned.length ? 'pointer-events-none opacity-40' : ''}`}><FileText className="w-4 h-4" />PDF du jour</a>
          <button onClick={() => send()} disabled={busy || !planned.length} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-green-600 text-white disabled:opacity-40"><Send className="w-4 h-4" />{sentAll ? 'Renvoyer' : 'Envoyer'} sur WhatsApp</button>
        </div>
      </div>
      {msg && <div className={`text-sm rounded-lg p-2.5 border ${msg.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.s}</div>}
      {data && !data.whatsapp && <div className="text-xs rounded-lg p-2.5 border border-amber-200 bg-amber-50 text-amber-800 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />WhatsApp n&apos;est pas encore relié (variable WHATSAPP_PROVIDER). L&apos;envoi génère alors, pour chaque personne, un bouton « Ouvrir WhatsApp » avec le message et le lien du PDF — il suffit de cliquer.</div>}

      {/* Prévu vs équipes planifiées */}
      {data && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-gray-200"><th className="text-left p-2.5 font-medium">Hub</th>{slots.map(s => <th key={s} className="p-2 font-medium whitespace-nowrap">{st(s)}</th>)}<th className="p-2 font-medium">Équipes</th></tr></thead>
            <tbody>
              {data.hubs.map(h => {
                const f = fc?.hubs.find(x => x.code === h.code); const teams = planned.filter(l => l.hubCode === h.code).length
                return (
                  <tr key={h.code} className="border-b border-gray-100">
                    <td className="p-2.5"><div className="font-medium text-gray-900">{h.name.replace('Marjane ', '')}</div><div className="text-[11px] text-gray-400">{h.city}</div></td>
                    {slots.map(s => {
                      const exp = f?.cells[s]?.expected ?? null, n = teamsAt(h.code, s), cap = n * perDriver
                      const tone = exp == null ? 'bg-gray-50 text-gray-300' : exp === 0 ? 'bg-gray-50 text-gray-400' : cap >= exp ? (exp / Math.max(cap, 1) >= 0.7 ? 'bg-amber-100 text-amber-900' : 'bg-green-50 text-green-800') : 'bg-red-100 text-red-800 font-semibold'
                      return <td key={s} className="p-1"><div className={`rounded-md py-1 text-center text-xs ${tone}`} title={`${exp ?? '…'} commandes prévues · ${n} équipe(s) × ${perDriver} = capacité ${cap}`}><b className="text-sm">{exp ?? '…'}</b> prévues<div className="text-[10px] opacity-70">{n} éq. · cap. {cap}{exp != null && exp > cap ? ` · manque ${Math.ceil((exp - cap) / perDriver)}` : ''}</div></div></td>
                    })}
                    <td className="p-2 text-center font-semibold">{teams}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tableau de planning : un hub = une colonne ; glisser une équipe d'un hub à l'autre */}
      {!data ? <div className="text-sm text-gray-400">Chargement…</div> : (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {col('__none', 'Non planifiés', 'ne travaillent pas ce jour', unplanned.length, <>{unplanned.map(card)}{!unplanned.length && <div className="text-xs text-gray-300 text-center py-6">Tout le monde est planifié</div>}</>)}
          {data.hubs.map(h => {
            const list = planned.filter(l => l.hubCode === h.code).sort((a, b) => a.departTime.localeCompare(b.departTime))
            return col(h.code, h.name.replace('Marjane ', ''), h.city, list.length, <>{list.map(l => byCode.get(l.driverCode)).filter((d): d is Drv => !!d).map(card)}{!list.length && <div className="text-xs text-gray-300 text-center py-6">Glissez des équipes ici</div>}</>)
          })}
        </div>
      )}

      {out && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOut(null)}>
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2"><div className="font-semibold text-gray-900">Envoi du planning — {out.teams} équipe(s)</div><button onClick={() => setOut(null)}><X className="w-5 h-5" /></button></div>
            <div className="flex flex-wrap gap-2 text-xs mb-3">
              {out.whatsapp ? <><span className="px-2 py-1 rounded-full bg-green-100 text-green-700">{out.sent} envoyé(s)</span>{out.failed > 0 && <span className="px-2 py-1 rounded-full bg-red-100 text-red-700">{out.failed} échec(s)</span>}</> : <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800">{out.manual} message(s) prêt(s) — cliquez « Ouvrir WhatsApp » pour chacun</span>}
              {out.noPhone > 0 && <span className="px-2 py-1 rounded-full bg-red-100 text-red-700">{out.noPhone} sans numéro</span>}
            </div>
            <div className="border border-gray-100 rounded-lg divide-y divide-gray-100">
              {out.results.map(r => (
                <div key={r.code} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="flex-1 min-w-0"><div className="truncate">{r.name} <span className="text-[11px] text-gray-400">{r.role === 'chauffeur' ? 'chauffeur' : 'helper'} · {r.hub.replace('Marjane ', '')}</span></div><div className="text-[11px] text-gray-400">{r.phone ?? 'aucun numéro valide'}{r.error ? ` — ${r.error}` : ''}</div></div>
                  {r.status === 'sent' && <span className="text-xs text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />envoyé</span>}
                  {r.status === 'failed' && <span className="text-xs text-red-600">échec</span>}
                  {r.status === 'no_phone' && <span className="text-xs text-red-600">pas de n°</span>}
                  {r.status === 'manual' && r.waLink && <a href={r.waLink} target="_blank" className="text-xs px-2.5 py-1 rounded-lg bg-green-600 text-white flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />Ouvrir WhatsApp</a>}
                  <a href={r.pdf} target="_blank" className="text-xs px-2 py-1 rounded-lg border border-gray-300 flex items-center gap-1"><FileText className="w-3.5 h-3.5" />PDF</a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
