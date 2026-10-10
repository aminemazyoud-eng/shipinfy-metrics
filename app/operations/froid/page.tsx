'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Thermometer, RefreshCw, Download, AlertTriangle, FlaskConical, KeyRound } from 'lucide-react'
import OpsNav from '../components/OpsNav'

interface Th { min: number; max: number; graceMin: number }
interface VRow { vehicleRef: string; lastCelsius: number; lastAt: string; readings7d: number; state: 'OK' | 'HORS_SEUIL' | 'SILENCE'; openBreaches: number }
interface Pt { sensor: string; celsius: number; at: string }
interface Breach { sensor: string; startMs: number; endMs: number; ongoing: boolean; durationMin: number; peak: number; kind: 'HIGH' | 'LOW'; level: number; orders: { id: string; reference: string | null; externalId: string; status: string }[] }
interface Detail { thresholds: Th; canEdit: boolean; vehicle: string; from: number; to: number; count: number; sampled: boolean; readings: Pt[]; breaches: Breach[]; tours: { id: string; day: string; rotation: number; driverCode: string; status: string }[] }

const STATE_CLS = { OK: 'bg-green-100 text-green-700', HORS_SEUIL: 'bg-red-100 text-red-700', SILENCE: 'bg-gray-100 text-gray-600' }
const STATE_LBL = { OK: 'Dans la plage', HORS_SEUIL: 'Hors seuil', SILENCE: 'Pas de signal' }
const hm = (ms: number) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const deg = (n: number) => `${n.toFixed(1).replace('.', ',')} °C`
const COLORS = ['#7c3aed', '#0891b2', '#d97706', '#db2777']

function Chart({ pts, th, from, to, breaches }: { pts: Pt[]; th: Th; from: number; to: number; breaches: Breach[] }) {
  const W = 760, H = 240, L = 40, R = 10, T = 10, B = 24
  const vals = pts.map(p => p.celsius)
  const lo = Math.floor(Math.min(th.min - 2, ...vals)), hi = Math.ceil(Math.max(th.max + 2, ...vals))
  const x = (ms: number) => L + ((ms - from) / Math.max(1, to - from)) * (W - L - R)
  const y = (c: number) => T + (1 - (c - lo) / Math.max(1, hi - lo)) * (H - T - B)
  const sensors = [...new Set(pts.map(p => p.sensor))]
  const ticks = Array.from({ length: 5 }, (_, i) => from + ((to - from) * i) / 4)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-white border border-gray-200 rounded-xl" role="img" aria-label="Courbe de température">
      <rect x={L} y={y(th.max)} width={W - L - R} height={Math.max(0, y(th.min) - y(th.max))} fill="#dcfce7" opacity={0.7} />
      {breaches.map((b, i) => <rect key={i} x={x(Math.max(from, b.startMs))} y={T} width={Math.max(2, x(Math.min(to, b.endMs)) - x(Math.max(from, b.startMs)))} height={H - T - B} fill="#fecaca" opacity={0.55} />)}
      {[lo, th.min, th.max, hi].map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeDasharray={v === th.min || v === th.max ? '4 3' : undefined} /><text x={L - 4} y={y(v) + 3} fontSize="9" textAnchor="end" fill="#6b7280">{v}</text></g>)}
      {ticks.map((t, i) => <text key={i} x={x(t)} y={H - 8} fontSize="9" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} fill="#6b7280">{hm(t)}</text>)}
      {sensors.map((s, si) => {
        const line = pts.filter(p => p.sensor === s)
        return <polyline key={s} fill="none" stroke={COLORS[si % COLORS.length]} strokeWidth="1.6" points={line.map(p => `${x(new Date(p.at).getTime()).toFixed(1)},${y(p.celsius).toFixed(1)}`).join(' ')} />
      })}
      {sensors.length > 1 && sensors.map((s, si) => <text key={s} x={L + 6 + si * 90} y={T + 10} fontSize="10" fill={COLORS[si % COLORS.length]}>■ {s}</text>)}
    </svg>
  )
}

export default function FroidPage() {
  const [list, setList] = useState<VRow[] | null>(null)
  const [th, setTh] = useState<Th | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [sel, setSel] = useState('')
  const [hours, setHours] = useState(24)
  const [det, setDet] = useState<Detail | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [tf, setTf] = useState({ min: '', max: '', graceMin: '' })
  const [testRef, setTestRef] = useState('')
  const [sensorId, setSensorId] = useState('')
  const [sensorSecret, setSensorSecret] = useState('')

  const loadList = useCallback(async () => {
    const r = await fetch('/api/ops/cold-chain')
    if (!r.ok) { setErr(r.status === 403 ? 'Accès refusé.' : 'Chargement impossible'); return }
    const j = await r.json(); setList(j.vehicles); setTh(j.thresholds); setCanEdit(j.canEdit)
    setTf(t => (t.min === '' ? { min: String(j.thresholds.min), max: String(j.thresholds.max), graceMin: String(j.thresholds.graceMin) } : t))
  }, [])
  const loadDet = useCallback(async () => {
    if (!sel) { setDet(null); return }
    const to = Date.now()
    const r = await fetch(`/api/ops/cold-chain?vehicle=${encodeURIComponent(sel)}&from=${new Date(to - hours * 3_600_000).toISOString()}&to=${new Date(to).toISOString()}`)
    if (r.ok) setDet(await r.json())
  }, [sel, hours])
  useEffect(() => { loadList(); const t = setInterval(loadList, 30000); return () => clearInterval(t) }, [loadList])
  useEffect(() => { loadDet(); const t = setInterval(loadDet, 30000); return () => clearInterval(t) }, [loadDet])

  const post = async (body: unknown) => {
    setErr(''); setMsg('')
    const r = await fetch('/api/ops/cold-chain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error || 'Erreur'); return null }
    return j
  }
  const exportUrl = (what: 'readings' | 'breaches') => det ? `/api/ops/cold-chain?vehicle=${encodeURIComponent(det.vehicle)}&from=${new Date(det.from).toISOString()}&to=${new Date(det.to).toISOString()}&format=xlsx&what=${what}` : '#'
  const last = useMemo(() => (det?.readings.length ? det.readings.slice(-15).reverse() : []), [det])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Thermometer className="w-5 h-5 text-cyan-600" /><h1 className="text-xl font-bold text-gray-900">Chaîne du froid</h1></div>
        <button onClick={() => { loadList(); loadDet() }} className="text-gray-500 hover:text-gray-800"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <OpsNav />
      <p className="text-sm text-gray-500">Lectures reçues des capteurs des véhicules. Plage acceptée {th ? `${th.min} à ${th.max} °C` : '…'}, tolérance {th ? `${th.graceMin} min` : '…'} avant rupture. <b>Aucun capteur réel n&apos;est branché tant que la passerelle n&apos;envoie rien à /api/iot/temperature</b> : utilisez le mode test ci-dessous pour valider les alertes.</p>
      {err && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">{err}</div>}
      {msg && <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded-lg p-3">{msg}</div>}

      <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
        {list?.map(v => (
          <button key={v.vehicleRef} onClick={() => setSel(v.vehicleRef)} className={`text-left bg-white border rounded-xl p-3 ${sel === v.vehicleRef ? 'border-cyan-500 ring-1 ring-cyan-300' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between"><span className="font-mono text-sm font-medium text-gray-900">{v.vehicleRef}</span><span className={`text-[11px] px-2 py-0.5 rounded-full ${STATE_CLS[v.state]}`}>{STATE_LBL[v.state]}</span></div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{deg(v.lastCelsius)}</div>
            <div className="text-xs text-gray-500">{hm(new Date(v.lastAt).getTime())} · {v.readings7d} lectures (7 j)</div>
            {v.openBreaches > 0 && <div className="mt-1 text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{v.openBreaches} rupture(s) en cours</div>}
          </button>
        ))}
        {list && list.length === 0 && <div className="md:col-span-3 text-sm text-gray-500 bg-white border border-gray-200 rounded-xl p-4">Aucune lecture sur 7 jours. {canEdit ? 'Injectez des lectures de test ci-dessous.' : 'Demandez à un administrateur de brancher un capteur ou de lancer un test.'}</div>}
      </div>

      {det && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-gray-900">Véhicule {det.vehicle}</h2>
            <select value={hours} onChange={e => setHours(Number(e.target.value))} className="text-sm border border-gray-300 rounded-lg px-2 py-1">
              <option value={6}>6 h</option><option value={24}>24 h</option><option value={72}>3 jours</option><option value={168}>7 jours</option>
            </select>
            <span className="text-xs text-gray-400">{det.count} lectures{det.sampled ? ' (courbe échantillonnée)' : ''}</span>
            <a href={exportUrl('readings')} className="ml-auto text-xs px-2 py-1 border border-gray-300 rounded-lg flex items-center gap-1"><Download className="w-3 h-3" />Lectures .xlsx</a>
            <a href={exportUrl('breaches')} className="text-xs px-2 py-1 border border-gray-300 rounded-lg flex items-center gap-1"><Download className="w-3 h-3" />Ruptures .xlsx</a>
          </div>
          {det.readings.length ? <Chart pts={det.readings} th={det.thresholds} from={det.from} to={det.to} breaches={det.breaches} /> : <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-xl p-4">Aucune lecture sur cette période.</div>}
          {det.tours.length > 0 && <div className="text-xs text-gray-500">Tournées du véhicule : {det.tours.map(t => `${t.day} R${t.rotation} (${t.driverCode}, ${t.status})`).join(' · ')}</div>}

          <div className="grid lg:grid-cols-2 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="font-medium text-gray-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" />Ruptures ({det.breaches.length})</div>
              {det.breaches.length === 0 && <div className="text-sm text-green-700">Aucune rupture sur la période.</div>}
              {det.breaches.map((b, i) => (
                <div key={i} className="border border-red-100 bg-red-50/40 rounded-lg p-2 text-sm">
                  <div className="font-medium text-gray-900">{hm(b.startMs)} → {b.ongoing ? 'en cours' : hm(b.endMs)} · {Math.round(b.durationMin)} min · {b.kind === 'HIGH' ? 'max' : 'min'} {deg(b.peak)} <span className="text-xs text-gray-500">(capteur {b.sensor}, niveau {b.level})</span></div>
                  <div className="text-xs text-gray-600 mt-0.5">{b.orders.length ? <>Commandes froides concernées : {b.orders.map(o => o.reference || o.externalId).join(', ')}</> : 'Aucune commande froide rattachée (pas de tournée ou pas de ligne froide).'}</div>
                </div>
              ))}
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <div className="font-medium text-gray-900 mb-2">Dernières lectures</div>
              <table className="w-full text-sm"><tbody>
                {last.map((p, i) => {
                  const out = p.celsius > det.thresholds.max || p.celsius < det.thresholds.min
                  return <tr key={i} className="border-b border-gray-50"><td className="py-1 text-gray-500">{hm(new Date(p.at).getTime())}</td><td className="text-gray-500">{p.sensor}</td><td className={`text-right font-medium ${out ? 'text-red-600' : 'text-gray-900'}`}>{deg(p.celsius)}</td></tr>
                })}
              </tbody></table>
            </div>
          </div>
        </div>
      )}

      {canEdit && th && (
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="font-medium text-gray-900">Seuils (administrateur)</div>
            <div className="grid grid-cols-3 gap-2">
              {([['min', 'Min °C'], ['max', 'Max °C'], ['graceMin', 'Tolérance (min)']] as const).map(([k, l]) => (
                <label key={k} className="text-xs text-gray-600">{l}<input value={tf[k]} onChange={e => setTf({ ...tf, [k]: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
              ))}
            </div>
            <button onClick={async () => { const j = await post({ action: 'thresholds', min: Number(tf.min.replace(',', '.')), max: Number(tf.max.replace(',', '.')), graceMin: Number(tf.graceMin.replace(',', '.')) }); if (j) { setMsg('Seuils enregistrés.'); loadList(); loadDet() } }} className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-lg">Enregistrer</button>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="font-medium text-gray-900 flex items-center gap-2"><FlaskConical className="w-4 h-4 text-purple-600" />Mode test (capteur « test »)</div>
            <input placeholder="Plaque du véhicule (ex. 12345-A-6)" value={testRef} onChange={e => setTestRef(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
            <div className="flex flex-wrap gap-2">
              <button disabled={!testRef} onClick={async () => { const j = await post({ action: 'inject', vehicleRef: testRef, scenario: 'ok' }); if (j) { setMsg(`${j.accepted} lectures normales injectées.`); setSel(testRef.trim().toUpperCase()); loadList() } }} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50">Injecter : tout va bien</button>
              <button disabled={!testRef} onClick={async () => { const j = await post({ action: 'inject', vehicleRef: testRef, scenario: 'breach' }); if (j) { setMsg(`${j.accepted} lectures injectées dont une rupture ; alertes créées : ${j.evaluation?.alerts ?? 0}.`); setSel(testRef.trim().toUpperCase()); loadList() } }} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg disabled:opacity-50">Injecter : rupture</button>
              <button onClick={async () => { if (!confirm('Supprimer toutes les lectures du capteur « test » ?')) return; const j = await post({ action: 'purge-test' }); if (j) { setMsg(`${j.deleted} lectures de test supprimées.`); loadList(); loadDet() } }} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg">Purger les tests</button>
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
