'use client'
import { useState, useEffect } from 'react'
import { Route } from 'lucide-react'

interface Settings { [k: string]: number | number[] }
const PARAMS: [string, string, string][] = [
  ['serviceMin', 'Temps de service par stop (min)', ''], ['maxStops', 'Capacité : stops par rotation', ''], ['rotationsPerSlot', 'Rotations max par créneau', ''], ['loadMin', 'Chargement avant départ (min)', ''],
  ['maxPostpones', 'Reports max par commande', ''], ['etaDriftNotifyMin', 'Prévenir le client si l\'ETA dérive de (min)', ''], ['baseSpeedKmh', 'Vitesse moyenne hors trafic (km/h)', ''],
  ['roadFactor', 'Facteur de détour route / vol d\'oiseau', ''], ['trafficCoef', 'Coefficient de trafic global (>1 = plus lent)', ''], ['waveTarget', 'Vagues : taille cible d\'un lot', ''], ['waveMax', 'Vagues : taille max d\'un lot', ''], ['waveWidenMin', 'Vagues : fenêtre élargie (min)', ''],
]

// Paramétrage → Tournées & ETA : temps de service, capacités, vitesse, trafic, vagues de préparation. Les actions (construire, réoptimiser) restent dans Opérations → Tournées.
export default function TourneesParamsPage() {
  const [set, setSet] = useState<Settings | null>(null)
  const [curve, setCurve] = useState('')
  const [flash, setFlash] = useState('')
  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(''), 6000) }

  useEffect(() => {
    fetch('/api/ops/tours/params').then(r => r.ok ? r.json() : null).then(j => { if (j) { setSet(j.settings); setCurve((j.settings.trafficCurve as number[]).join(', ')) } }).catch(() => {})
  }, [])
  const saveSettings = async () => {
    if (!set) return
    const body: Record<string, unknown> = { ...set }
    const c = curve.split(/[,\s;]+/).filter(Boolean).map(Number)
    if (c.length === 24) body.trafficCurve = c; else delete body.trafficCurve
    const r = await fetch('/api/ops/tours/params', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (r.ok) { setSet(j.settings); setCurve((j.settings.trafficCurve as number[]).join(', ')); say(c.length === 24 || !curve.trim() ? 'Réglages enregistrés' : 'Réglages enregistrés (la courbe doit contenir 24 valeurs : ignorée)') } else say(j.error ?? 'Accès refusé ou valeurs hors bornes')
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Route className="w-5 h-5 text-purple-600" />Tournées &amp; ETA</h1>
        <p className="text-sm text-gray-500">Réglages des tournées, du calcul d&apos;ETA (vitesse, détour, trafic) et des vagues de préparation. Construire ou réoptimiser les tournées se fait dans Opérations → Tournées.</p>
      </div>
      {flash && <div className="rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm px-3 py-2">{flash}</div>}
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="font-semibold text-gray-800">Réglages tournées, ETA et vagues</h2>
        {!set ? <div className="text-sm text-gray-400">Chargement…</div> : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {PARAMS.map(([k, label]) => (
                <label key={k} className="text-xs text-gray-500">{label}
                  <input type="number" step="any" value={typeof set[k] === 'number' ? (set[k] as number) : ''} onChange={e => setSet({ ...set, [k]: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
                </label>
              ))}
            </div>
            <label className="text-xs text-gray-500 block">Courbe de vitesse par heure locale (24 valeurs, 0h → 23h ; 1 = fluide, 0,6 = dense) — valeurs de départ à calibrer avec vos données
              <textarea value={curve} onChange={e => setCurve(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-mono text-gray-900" />
            </label>
            <button onClick={saveSettings} className="px-4 py-1.5 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700">Enregistrer</button>
          </>
        )}
      </div>
    </div>
  )
}
