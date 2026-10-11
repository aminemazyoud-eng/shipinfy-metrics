'use client'
import { useState, useEffect, useCallback } from 'react'
import { Thermometer, FlaskConical, KeyRound } from 'lucide-react'

interface Th { min: number; max: number; graceMin: number }

// Paramétrage → Chaîne du froid : seuils, mode test, secrets capteurs (ADMIN, contrôlé par l'API). Le suivi (courbe, ruptures, export) est dans Opérations → Chaîne du froid.
export default function FroidParamsPage() {
  const [th, setTh] = useState<Th | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [tf, setTf] = useState({ min: '', max: '', graceMin: '' })
  const [testRef, setTestRef] = useState('')
  const [sensorId, setSensorId] = useState('')
  const [sensorSecret, setSensorSecret] = useState('')

  const loadList = useCallback(async () => {
    const r = await fetch('/api/ops/cold-chain')
    if (!r.ok) { setErr(r.status === 403 ? 'Accès refusé.' : 'Chargement impossible'); return }
    const j = await r.json(); setTh(j.thresholds); setCanEdit(j.canEdit)
    setTf({ min: String(j.thresholds.min), max: String(j.thresholds.max), graceMin: String(j.thresholds.graceMin) })
  }, [])
  useEffect(() => { void loadList() }, [loadList])

  const post = async (body: unknown) => {
    setErr(''); setMsg('')
    const r = await fetch('/api/ops/cold-chain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error || 'Erreur'); return null }
    return j
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Thermometer className="w-5 h-5 text-cyan-600" />Chaîne du froid</h1>
        <p className="text-sm text-gray-500">Seuils de température, secrets des capteurs et mode test. Le suivi (courbe, lectures, ruptures, export) est dans Opérations → Chaîne du froid.</p>
      </div>
      {err && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">{err}</div>}
      {msg && <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded-lg p-3">{msg}</div>}
      {!canEdit && th && <div className="text-sm text-gray-500">Lecture seule : réservé aux administrateurs. Plage actuelle {th.min} à {th.max} °C, tolérance {th.graceMin} min.</div>}
      {canEdit && th && (
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="font-medium text-gray-900">Seuils (administrateur)</div>
            <div className="grid grid-cols-3 gap-2">
              {([['min', 'Min °C'], ['max', 'Max °C'], ['graceMin', 'Tolérance (min)']] as const).map(([k, l]) => (
                <label key={k} className="text-xs text-gray-600">{l}<input value={tf[k]} onChange={e => setTf({ ...tf, [k]: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
              ))}
            </div>
            <button onClick={async () => { const j = await post({ action: 'thresholds', min: Number(tf.min.replace(',', '.')), max: Number(tf.max.replace(',', '.')), graceMin: Number(tf.graceMin.replace(',', '.')) }); if (j) { setMsg('Seuils enregistrés.'); loadList() } }} className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-lg">Enregistrer</button>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="font-medium text-gray-900 flex items-center gap-2"><FlaskConical className="w-4 h-4 text-purple-600" />Mode test (capteur « test »)</div>
            <input placeholder="Plaque du véhicule (ex. 12345-A-6)" value={testRef} onChange={e => setTestRef(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
            <div className="flex flex-wrap gap-2">
              <button disabled={!testRef} onClick={async () => { const j = await post({ action: 'inject', vehicleRef: testRef, scenario: 'ok' }); if (j) { setMsg(`${j.accepted} lectures normales injectées.`); loadList() } }} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50">Injecter : tout va bien</button>
              <button disabled={!testRef} onClick={async () => { const j = await post({ action: 'inject', vehicleRef: testRef, scenario: 'breach' }); if (j) { setMsg(`${j.accepted} lectures injectées dont une rupture ; alertes créées : ${j.evaluation?.alerts ?? 0}.`); loadList() } }} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg disabled:opacity-50">Injecter : rupture</button>
              <button onClick={async () => { if (!confirm('Supprimer toutes les lectures du capteur « test » ?')) return; const j = await post({ action: 'purge-test' }); if (j) { setMsg(`${j.deleted} lectures de test supprimées.`); loadList() } }} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg">Purger les tests</button>
            </div>
            <p className="text-xs text-gray-500">Une rupture de test crée une vraie alerte (niveau 2 ou 3 : notification Slack / e-mail si configurés).</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2 lg:col-span-2">
            <div className="font-medium text-gray-900 flex items-center gap-2"><KeyRound className="w-4 h-4 text-gray-500" />Secret HMAC d&apos;un capteur</div>
            <div className="flex gap-2"><input placeholder="Identifiant du capteur (ex. frigo-01)" value={sensorId} onChange={e => setSensorId(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              <button disabled={!sensorId} onClick={async () => { const j = await post({ action: 'sensor-secret', sensorId }); if (j) setSensorSecret(j.secret) }} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50">Afficher</button></div>
            {sensorSecret && <code className="block bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs break-all">{sensorSecret}</code>}
          </div>
        </div>
      )}
    </div>
  )
}
