'use client'
import { useState, useEffect, useCallback } from 'react'
import { Car, Fuel, Wrench, AlertTriangle, RefreshCw } from 'lucide-react'
import OpsNav from '../components/OpsNav'

interface V { id: string; plate: string; type: string; fuelType: string; status: string; odometerKm: number; theoreticalL100: number | null; hub: string | null; hubCode: string | null; driver: string | null; helper: string | null
  fuel: { liters: number; cost: number; fills: number; km: number; realL100: number | null; costPerKm: number | null }; maintenanceCost: number; lastMaintenance: { type: string; date: string } | null; alerts: { type: string; dueDate: string | null; dueKm: number | null }[] }
interface Res { days: number; vehicles: V[]; totals: { vehicles: number; active: number; liters: number; fuelCost: number; maintenanceCost: number; alerts: number } }

const ST: Record<string, string> = { active: 'bg-green-100 text-green-700', maintenance: 'bg-amber-100 text-amber-700', out_of_service: 'bg-red-100 text-red-700' }
const TYPES = ['vidange', 'pneus', 'freins', 'revision', 'reparation', 'assurance', 'visite_technique', 'autre']
const mad = (n: number) => `${n.toLocaleString('fr-FR')} MAD`

export default function FlottePage() {
  const [days, setDays] = useState(30)
  const [res, setRes] = useState<Res | null>(null)
  const [form, setForm] = useState<{ kind: 'fuel' | 'maintenance'; v: V } | null>(null)
  const [f, setF] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  const load = useCallback(async () => { const r = await fetch(`/api/ops/fleet?days=${days}`); if (r.ok) setRes(await r.json()) }, [days])
  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!form) return
    const r = await fetch('/api/ops/fleet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: form.kind, vehicleId: form.v.id, ...f }) })
    const j = await r.json(); if (r.ok) { setForm(null); setF({}); setErr(''); load() } else setErr(j.error || 'Erreur')
  }
  const setStatus = async (v: V, status: string) => { await fetch('/api/ops/fleet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'status', vehicleId: v.id, status }) }); load() }
  const inp = (k: string, label: string, type = 'text') => <label className="text-xs text-gray-600 block">{label}<input type={type} value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Car className="w-5 h-5 text-purple-600" />Flotte & gasoil</h1>
        <div className="flex items-center gap-2"><select value={days} onChange={e => setDays(Number(e.target.value))} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">{[7, 30, 90].map(d => <option key={d} value={d}>{d} jours</option>)}</select><button onClick={load} className="p-2 border border-gray-300 rounded-lg bg-white"><RefreshCw className="w-4 h-4" /></button></div>
      </div>
      <OpsNav />
      {res && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[['Véhicules actifs', `${res.totals.active}/${res.totals.vehicles}`], ['Litres', res.totals.liters], ['Coût gasoil', mad(res.totals.fuelCost)], ['Entretien', mad(res.totals.maintenanceCost)], ['Alertes entretien', res.totals.alerts]].map(([l, v], i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-3"><div className="text-xs text-gray-500">{l}</div><div className={`text-xl font-bold ${i === 4 && res.totals.alerts ? 'text-red-600' : 'text-gray-900'}`}>{v}</div></div>
          ))}
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200">{['Véhicule', 'Équipe', 'Hub', 'Km', 'Litres', 'Coût gasoil', 'L/100 réel', 'MAD/km', 'Statut', ''].map(h => <th key={h} className="p-2 font-medium whitespace-nowrap first:pl-3">{h}</th>)}</tr></thead>
          <tbody>
            {res?.vehicles.map(v => {
              const over = v.fuel.realL100 && v.theoreticalL100 && v.fuel.realL100 > v.theoreticalL100 * 1.15
              return (
                <tr key={v.id} className="border-t border-gray-100">
                  <td className="p-2 pl-3"><div className="font-medium">{v.plate}</div><div className="text-xs text-gray-400">{v.type} · {v.fuelType}</div></td>
                  <td className="p-2 text-gray-600">{v.driver ?? '—'}{v.helper && <div className="text-xs text-gray-400">+ {v.helper}</div>}</td><td className="p-2 text-gray-500">{v.hub?.replace('Marjane ', '')}</td>
                  <td className="p-2">{Math.round(v.odometerKm).toLocaleString('fr-FR')}</td><td className="p-2">{v.fuel.liters}</td><td className="p-2">{mad(v.fuel.cost)}</td>
                  <td className={`p-2 ${over ? 'text-red-600 font-semibold' : ''}`} title={`théorique ${v.theoreticalL100 ?? '?'}`}>{v.fuel.realL100 ?? '—'}</td><td className="p-2">{v.fuel.costPerKm ?? '—'}</td>
                  <td className="p-2"><select value={v.status} onChange={e => setStatus(v, e.target.value)} className={`text-xs rounded-full px-2 py-1 border-0 ${ST[v.status]}`}><option value="active">Actif</option><option value="maintenance">Entretien</option><option value="out_of_service">Hors service</option></select>{v.alerts.length > 0 && <AlertTriangle className="w-4 h-4 text-red-500 inline ml-1" />}</td>
                  <td className="p-2 whitespace-nowrap"><button onClick={() => { setForm({ kind: 'fuel', v }); setF({}) }} className="p-1.5 rounded-md border border-gray-300 mr-1" title="Ajouter un plein"><Fuel className="w-4 h-4" /></button><button onClick={() => { setForm({ kind: 'maintenance', v }); setF({}) }} className="p-1.5 rounded-md border border-gray-300" title="Ajouter un entretien"><Wrench className="w-4 h-4" /></button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">L/100 réel = litres / km entre le premier et le dernier relevé kilométrique de la période. En rouge si &gt; 15 % au-dessus de la consommation théorique.</p>

      {form && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
            <div className="font-semibold">{form.kind === 'fuel' ? 'Nouveau plein' : 'Nouvel entretien'} — {form.v.plate}</div>
            {form.kind === 'fuel' ? (<>{inp('liters', 'Litres', 'number')}{inp('amountMad', 'Montant (MAD)', 'number')}{inp('odometerKm', 'Kilométrage', 'number')}{inp('station', 'Station')}</>) : (<>
              <label className="text-xs text-gray-600 block">Type<select value={f.type ?? ''} onChange={e => setF({ ...f, type: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"><option value="">—</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
              {inp('costMad', 'Coût (MAD)', 'number')}{inp('odometerKm', 'Kilométrage', 'number')}{inp('nextDueKm', 'Prochain à (km)', 'number')}{inp('nextDueDate', 'Prochaine échéance', 'date')}{inp('notes', 'Notes')}</>)}
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2"><button onClick={() => setForm(null)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg">Annuler</button><button onClick={submit} className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg">Enregistrer</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
