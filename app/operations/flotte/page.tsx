'use client'
import { useState, useEffect, useCallback } from 'react'
import { Car, Fuel, Wrench, Route, AlertTriangle, RefreshCw, Flag, Play } from 'lucide-react'
import OpsNav from '../components/OpsNav'

interface V { id: string; plate: string; type: string; fuelType: string; status: string; odometerKm: number; theoreticalL100: number | null; hub: string | null; hubCode: string | null; driver: string | null; helper: string | null
  fuel: { liters: number; cost: number; fills: number; km: number; realL100: number | null; costPerKm: number | null }; maintenanceCost: number; lastMaintenance: { type: string; date: string } | null; alerts: { type: string; dueDate: string | null; dueKm: number | null }[] }
interface Res { days: number; alertPct?: number; vehicles: V[]; totals: { vehicles: number; active: number; liters: number; fuelCost: number; maintenanceCost: number; alerts: number } }
interface Mission { id: string; vehicleId: string; plate: string; hubCode: string | null; startAt: string; endAt: string | null; startKm: number | null; endKm: number | null; status: string; driver: string | null; helper: string | null; km: number | null; minutes: number | null; liters: number }
interface Logs { missions: Mission[]; open: { vehicleId: string; id: string; startAt: string; startKm: number | null }[]
  fuel: { id: string; plate: string; date: string; liters: number; amountMad: number; odometerKm: number | null; station: string | null; missionId: string | null }[]
  maintenance: { id: string; plate: string; date: string; type: string; costMad: number; odometerKm: number | null; status: string }[] }
type Form = { kind: 'fuel' | 'maintenance' | 'mission-start' | 'mission-end'; v: V; missionId?: string }

const ST: Record<string, string> = { active: 'bg-green-100 text-green-700', maintenance: 'bg-amber-100 text-amber-700', out_of_service: 'bg-red-100 text-red-700' }
const TYPES = ['vidange', 'pneus', 'freins', 'revision', 'reparation', 'assurance', 'visite_technique', 'vignette', 'autre']
const mad = (n: number) => `${n.toLocaleString('fr-FR')} MAD`
const dt = (d: string | null) => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const hm = (d: string | null) => (d ? new Date(d).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit' }) : '—')
const dur = (m: number | null) => (m == null ? '—' : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`)
/** valeur initiale d'un champ datetime-local = maintenant, heure locale du navigateur */
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined)

export default function FlottePage() {
  const [days, setDays] = useState(30)
  const [res, setRes] = useState<Res | null>(null)
  const [logs, setLogs] = useState<Logs | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [f, setF] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch(`/api/ops/fleet?days=${days}`), fetch('/api/ops/missions?days=7')])
    if (a.ok) setRes(await a.json()); if (b.ok) setLogs(await b.json())
  }, [days])
  useEffect(() => { load() }, [load])

  const openForm = (kind: Form['kind'], v: V, missionId?: string) => { setForm({ kind, v, missionId }); setErr(''); setF({ when: nowLocal(), ...(kind === 'mission-start' ? { startKm: String(Math.round(v.odometerKm)) } : {}) }) }
  const submit = async () => {
    if (!form) return
    const { kind, v, missionId } = form
    const when = toIso(f.when)
    const [url, body] = kind === 'fuel' ? ['/api/ops/fleet', { kind: 'fuel', vehicleId: v.id, date: when, liters: f.liters, amountMad: f.amountMad, odometerKm: f.odometerKm, station: f.station }]
      : kind === 'maintenance' ? ['/api/ops/fleet', { kind: 'maintenance', vehicleId: v.id, date: when, type: f.type, costMad: f.costMad, odometerKm: f.odometerKm, nextDueKm: f.nextDueKm, nextDueDate: f.nextDueDate, notes: f.notes }]
      : kind === 'mission-start' ? ['/api/ops/missions', { action: 'start', vehicleId: v.id, startAt: when, startKm: f.startKm, notes: f.notes }]
      : ['/api/ops/missions', { action: 'end', id: missionId, endAt: when, endKm: f.endKm, notes: f.notes }]
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json(); if (r.ok) { setForm(null); load() } else setErr(j.error || 'Erreur')
  }
  const setStatus = async (v: V, status: string) => { await fetch('/api/ops/fleet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'status', vehicleId: v.id, status }) }); load() }
  const inp = (k: string, label: string, type = 'text', step?: string) => <label className="text-xs text-gray-600 block">{label}<input type={type} step={step} value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
  const openOf = (v: V) => logs?.open.find(o => o.vehicleId === v.id)
  const today = new Date().toISOString().slice(0, 10)
  const todays = logs?.missions.filter(m => m.startAt.slice(0, 10) === today) ?? []
  const title = { fuel: 'Plein de carburant', maintenance: 'Entretien', 'mission-start': 'Départ de la journée', 'mission-end': 'Fin de la journée (retour)' }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Car className="w-5 h-5 text-purple-600" />Flotte, missions & gasoil</h1>
        <div className="flex items-center gap-2"><select value={days} onChange={e => setDays(Number(e.target.value))} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">{[7, 30, 90].map(d => <option key={d} value={d}>{d} jours</option>)}</select><button onClick={load} className="p-2 border border-gray-300 rounded-lg bg-white"><RefreshCw className="w-4 h-4" /></button></div>
      </div>
      <OpsNav />
      {res && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[['Véhicules actifs', `${res.totals.active}/${res.totals.vehicles}`], ['Missions en cours', logs?.open.length ?? 0], ['Km aujourd’hui', Math.round(todays.reduce((s, m) => s + (m.km ?? 0), 0))], ['Coût gasoil', mad(res.totals.fuelCost)], ['Entretien', mad(res.totals.maintenanceCost)], ['Alertes entretien', res.totals.alerts]].map(([l, v], i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">{l}</div><div className={`text-xl font-bold ${i === 5 && res.totals.alerts ? 'text-red-600' : 'text-gray-900'}`}>{v}</div></div>
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200">{['Véhicule', 'Équipe', 'Hub', 'Km', 'Mission', 'Litres', 'Coût gasoil', 'L/100 réel', 'Statut', 'Actions'].map(h => <th key={h} className="p-2 font-medium whitespace-nowrap first:pl-3">{h}</th>)}</tr></thead>
          <tbody>
            {res?.vehicles.map(v => {
              const open = openOf(v)
              const over = v.fuel.realL100 && v.theoreticalL100 && v.fuel.realL100 > v.theoreticalL100 * (1 + (res.alertPct ?? 15) / 100)
              return (
                <tr key={v.id} className="border-t border-gray-100">
                  <td className="p-2 pl-3"><div className="font-medium">{v.plate}</div><div className="text-xs text-gray-400">{v.type} · {v.fuelType}</div></td>
                  <td className="p-2 text-gray-600">{v.driver ?? '—'}{v.helper && <div className="text-xs text-gray-400">+ {v.helper}</div>}</td><td className="p-2 text-gray-500">{v.hub?.replace('Marjane ', '')}</td>
                  <td className="p-2">{Math.round(v.odometerKm).toLocaleString('fr-FR')}</td>
                  <td className="p-2">{open ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700"><Route className="w-3 h-3" />en cours depuis {hm(open.startAt)}</span> : <span className="text-xs text-gray-300">—</span>}</td>
                  <td className="p-2">{v.fuel.liters}</td><td className="p-2">{mad(v.fuel.cost)}</td>
                  <td className={`p-2 ${over ? 'text-red-600 font-semibold' : ''}`} title={`théorique ${v.theoreticalL100 ?? '?'}`}>{v.fuel.realL100 ?? '—'}</td>
                  <td className="p-2"><select value={v.status} onChange={e => setStatus(v, e.target.value)} className={`text-xs rounded-full px-2 py-1 border-0 ${ST[v.status]}`}><option value="active">Actif</option><option value="maintenance">Entretien</option><option value="out_of_service">Hors service</option></select>{v.alerts.length > 0 && <AlertTriangle className="w-4 h-4 text-red-500 inline ml-1" />}</td>
                  <td className="p-2 whitespace-nowrap">
                    {open ? <button onClick={() => openForm('mission-end', v, open.id)} className="p-1.5 rounded-md bg-blue-600 text-white mr-1" title="Fin de la journée : retour au hub"><Flag className="w-4 h-4" /></button>
                      : <button onClick={() => openForm('mission-start', v)} disabled={v.status !== 'active'} className="p-1.5 rounded-md border border-blue-300 text-blue-700 mr-1 disabled:opacity-30" title="Départ de la journée (début de mission)"><Play className="w-4 h-4" /></button>}
                    <button onClick={() => openForm('fuel', v)} className="p-1.5 rounded-md border border-gray-300 mr-1" title="Ajouter un plein"><Fuel className="w-4 h-4" /></button>
                    <button onClick={() => openForm('maintenance', v)} className="p-1.5 rounded-md border border-gray-300" title="Ajouter un entretien"><Wrench className="w-4 h-4" /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">▶ Départ de la journée · 🏁 Fin de la journée (retour) · ⛽ Plein · 🔧 Entretien. Chaque plein et entretien est daté (jour et heure) et rattaché à la mission en cours. L/100 réel en rouge si &gt; 15 % au-dessus du théorique (réglable dans Paramétrage → Calculs & équations).</p>

      <div className="grid xl:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <div className="p-3 text-sm font-medium text-gray-700 border-b border-gray-100 flex items-center gap-1.5"><Route className="w-4 h-4 text-blue-600" />Missions (7 derniers jours)</div>
          <table className="w-full text-sm"><thead><tr className="text-xs text-gray-500 text-left">{['Véhicule', 'Équipe', 'Départ', 'Retour', 'Durée', 'Km', 'Litres'].map(h => <th key={h} className="p-2 font-medium first:pl-3">{h}</th>)}</tr></thead>
            <tbody>{logs?.missions.map(m => (
              <tr key={m.id} className="border-t border-gray-100"><td className="p-2 pl-3">{m.plate}</td><td className="p-2 text-gray-600 text-xs">{m.driver}{m.helper ? ` + ${m.helper}` : ''}</td><td className="p-2">{dt(m.startAt)}</td>
                <td className="p-2">{m.endAt ? dt(m.endAt) : <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">en cours</span>}</td><td className="p-2">{dur(m.minutes)}</td><td className="p-2">{m.km ?? '—'}</td><td className="p-2">{m.liters || '—'}</td></tr>
            ))}{logs && !logs.missions.length && <tr><td colSpan={7} className="p-6 text-center text-gray-400">Aucune mission — cliquez ▶ sur un véhicule pour démarrer la journée</td></tr>}</tbody></table>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <div className="p-3 text-sm font-medium text-gray-700 border-b border-gray-100 flex items-center gap-1.5"><Fuel className="w-4 h-4 text-amber-600" />Prélèvements de gasoil & entretiens</div>
          <table className="w-full text-sm"><thead><tr className="text-xs text-gray-500 text-left">{['Date & heure', 'Véhicule', 'Opération', 'Litres', 'Montant', 'Km'].map(h => <th key={h} className="p-2 font-medium first:pl-3">{h}</th>)}</tr></thead>
            <tbody>
              {[...(logs?.fuel.map(x => ({ id: x.id, date: x.date, plate: x.plate, op: `⛽ ${x.station ?? 'plein'}${x.missionId ? ' · mission' : ''}`, liters: x.liters, amount: x.amountMad, km: x.odometerKm })) ?? []),
                ...(logs?.maintenance.map(x => ({ id: x.id, date: x.date, plate: x.plate, op: `🔧 ${x.type}`, liters: null as number | null, amount: x.costMad, km: x.odometerKm })) ?? [])]
                .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40).map(x => (
                  <tr key={x.id} className="border-t border-gray-100"><td className="p-2 pl-3 whitespace-nowrap">{dt(x.date)}</td><td className="p-2">{x.plate}</td><td className="p-2 text-gray-600">{x.op}</td><td className="p-2">{x.liters ?? '—'}</td><td className="p-2">{mad(x.amount)}</td><td className="p-2">{x.km ?? '—'}</td></tr>
                ))}
              {logs && !logs.fuel.length && !logs.maintenance.length && <tr><td colSpan={6} className="p-6 text-center text-gray-400">Aucun prélèvement — cliquez ⛽ sur un véhicule</td></tr>}
            </tbody></table>
        </div>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
            <div className="font-semibold">{title[form.kind]} — {form.v.plate}</div>
            {inp('when', form.kind === 'mission-start' ? 'Heure de départ' : form.kind === 'mission-end' ? 'Heure de retour' : 'Date et heure', 'datetime-local')}
            {form.kind === 'fuel' && (<>{inp('liters', 'Litres', 'number', '0.1')}{inp('amountMad', 'Montant (MAD)', 'number', '0.01')}{inp('odometerKm', 'Kilométrage au compteur', 'number')}{inp('station', 'Station')}</>)}
            {form.kind === 'maintenance' && (<>
              <label className="text-xs text-gray-600 block">Type<select value={f.type ?? ''} onChange={e => setF({ ...f, type: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"><option value="">—</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
              {inp('costMad', 'Coût (MAD)', 'number')}{inp('odometerKm', 'Kilométrage', 'number')}{inp('nextDueKm', 'Prochain à (km)', 'number')}{inp('nextDueDate', 'Prochaine échéance', 'date')}{inp('notes', 'Notes')}</>)}
            {form.kind === 'mission-start' && (<>{inp('startKm', 'Kilométrage au départ', 'number')}{inp('notes', 'Notes')}</>)}
            {form.kind === 'mission-end' && (<>{inp('endKm', 'Kilométrage au retour', 'number')}{inp('notes', 'Notes')}</>)}
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2"><button onClick={() => setForm(null)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg">Annuler</button><button onClick={submit} className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg">Enregistrer</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
