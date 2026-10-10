'use client'
import { useState } from 'react'

const iso = (d: Date) => d.toISOString().slice(0, 10)

// Saisie rapide du kilométrage d'une tournée (PATCH /api/ops/costing/tour-km) : remplace l'estimation « km par commande » par du réel.
export default function KmEntry({ drivers, onSaved }: { drivers: { code: string; name: string }[]; onSaved: () => void }) {
  const [day, setDay] = useState(iso(new Date())); const [driverCode, setDriver] = useState('')
  const [kmStart, setStart] = useState(''); const [kmEnd, setEnd] = useState(''); const [rotation, setRotation] = useState('1')
  const [msg, setMsg] = useState<string | null>(null)
  const save = async () => {
    const body = { day, driverCode, rotation: Number(rotation) || 1, ...(kmStart ? { kmStart: Number(kmStart.replace(',', '.')) } : {}), ...(kmEnd ? { kmEnd: Number(kmEnd.replace(',', '.')) } : {}) }
    const r = await fetch('/api/ops/costing/tour-km', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    setMsg(r.ok ? `Enregistré${j.tour?.km != null ? ` : ${j.tour.km} km` : ''}.` : (j.error ?? 'Erreur')); if (r.ok) onSaved()
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
      <div className="text-sm font-semibold text-gray-800 w-full">Saisie rapide des km d&apos;une tournée</div>
      <label className="text-xs text-gray-500">Jour<input type="date" value={day} onChange={e => setDay(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
      <label className="text-xs text-gray-500">Chauffeur<select value={driverCode} onChange={e => setDriver(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white w-48"><option value="">Choisir…</option>{drivers.map(d => <option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}</select></label>
      <label className="text-xs text-gray-500">Rotation<input value={rotation} onChange={e => setRotation(e.target.value)} inputMode="numeric" className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-16" /></label>
      <label className="text-xs text-gray-500">Km départ<input value={kmStart} onChange={e => setStart(e.target.value)} inputMode="decimal" className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-28" /></label>
      <label className="text-xs text-gray-500">Km arrivée<input value={kmEnd} onChange={e => setEnd(e.target.value)} inputMode="decimal" className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-28" /></label>
      <button disabled={!driverCode || (!kmStart && !kmEnd)} onClick={save} className="px-3 py-2 text-sm rounded-lg bg-purple-600 text-white disabled:opacity-40">Enregistrer</button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  )
}
