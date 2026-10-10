'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { MapPinned, RefreshCw, Trash2, Save, Plus } from 'lucide-react'
import OpsNav from '../components/OpsNav'

type LatLng = [number, number]
// Même règle que lib/ops-sectors.ts parsePolygon (copie locale : ce module importe prisma dynamiquement, à ne pas tirer dans le navigateur)
function parsePolygon(raw: string): LatLng[] | null {
  const t = raw.trim()
  if (!t) return null
  let v: unknown
  if (t.startsWith('[')) { try { v = JSON.parse(t) } catch { return null } }
  else v = t.split(/\r?\n|;/).map(l => l.trim()).filter(Boolean).map(l => l.split(/[,\s]+/).map(Number))
  if (!Array.isArray(v) || v.length < 3 || v.length > 500) return null
  const out: LatLng[] = []
  for (const p of v) {
    const a = Array.isArray(p) ? Number(p[0]) : NaN, b = Array.isArray(p) ? Number(p[1]) : NaN
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null
    out.push([a, b])
  }
  return out
}
interface Sector { id: string; code: string; name: string; hubCode: string | null; polygon: LatLng[]; active: boolean; ordersToday: number }
interface Hub { code: string; name: string; lat: number | null; lng: number | null }
interface Res { day: string; sectors: Sector[]; untagged: number; hubs: Hub[] }
const EMPTY = { id: '', code: '', name: '', hubCode: '', polygon: '', active: true }

// Aperçu SVG sans dépendance : lng → x, lat → -y, ajusté à l'emprise de tous les secteurs + hubs.
function Preview({ current, others, hubs }: { current: LatLng[] | null; others: Sector[]; hubs: Hub[] }) {
  const all: LatLng[] = [...(current ?? []), ...others.flatMap(s => s.polygon), ...hubs.filter(h => h.lat != null && h.lng != null).map(h => [h.lat as number, h.lng as number] as LatLng)]
  if (!all.length) return <div className="h-64 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-sm text-gray-400">Aperçu : saisissez au moins 3 points</div>
  const la = all.map(p => p[0]), ln = all.map(p => p[1])
  const minLa = Math.min(...la), maxLa = Math.max(...la), minLn = Math.min(...ln), maxLn = Math.max(...ln)
  const k = Math.cos((((minLa + maxLa) / 2) * Math.PI) / 180) // correction de longueur des degrés de longitude
  const w = Math.max((maxLn - minLn) * k, 1e-4), h = Math.max(maxLa - minLa, 1e-4), pad = Math.max(w, h) * 0.06
  const X = (lng: number) => (lng - minLn) * k, Y = (lat: number) => maxLa - lat
  const pts = (p: LatLng[]) => p.map(([a, b]) => `${X(b)},${Y(a)}`).join(' ')
  return (
    <svg viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`} className="w-full h-64 rounded-lg border border-gray-200 bg-slate-50" preserveAspectRatio="xMidYMid meet">
      {others.map(s => s.polygon.length >= 3 && <polygon key={s.id} points={pts(s.polygon)} fill="#94a3b8" fillOpacity={0.18} stroke="#64748b" strokeWidth={Math.max(w, h) / 400} />)}
      {current && current.length >= 3 && <polygon points={pts(current)} fill="#7c3aed" fillOpacity={0.3} stroke="#7c3aed" strokeWidth={Math.max(w, h) / 200} />}
      {current?.map((p, i) => <circle key={i} cx={X(p[1])} cy={Y(p[0])} r={Math.max(w, h) / 120} fill="#7c3aed" />)}
      {hubs.filter(x => x.lat != null && x.lng != null).map(x => <circle key={x.code} cx={X(x.lng as number)} cy={Y(x.lat as number)} r={Math.max(w, h) / 70} fill="#16a34a" stroke="#fff" strokeWidth={Math.max(w, h) / 400}><title>{x.name}</title></circle>)}
    </svg>
  )
}

export default function SecteursPage() {
  const [res, setRes] = useState<Res | null>(null)
  const [f, setF] = useState(EMPTY)
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => { const r = await fetch('/api/ops/sectors'); if (r.ok) setRes(await r.json()) }, [])
  useEffect(() => { load() }, [load])

  const poly = useMemo(() => parsePolygon(f.polygon), [f.polygon])
  const edit = (s: Sector) => setF({ id: s.id, code: s.code, name: s.name, hubCode: s.hubCode ?? '', polygon: s.polygon.map(p => p.join(', ')).join('\n'), active: s.active })
  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(''), 5000) }

  const save = async () => {
    setBusy(true)
    const r = await fetch('/api/ops/sectors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, id: f.id || undefined, hubCode: f.hubCode || null }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (r.ok) { say('Secteur enregistré — lancez « Recalculer les commandes du jour » pour appliquer'); setF(EMPTY); load() } else say(j.error ?? 'Échec de l\'enregistrement')
  }
  const del = async (s: Sector) => {
    if (!confirm(`Supprimer le secteur ${s.code} — ${s.name} ?`)) return
    const r = await fetch(`/api/ops/sectors?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' })
    say(r.ok ? 'Secteur supprimé' : 'Échec de la suppression'); if (r.ok) { if (f.id === s.id) setF(EMPTY); load() }
  }
  const retag = async () => {
    setBusy(true)
    const r = await fetch('/api/ops/sectors/retag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    say(r.ok ? `${j.changed} commande(s) mises à jour sur ${j.scanned}` : j.error ?? 'Échec du recalcul'); if (r.ok) load()
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><MapPinned className="w-5 h-5 text-purple-600" />Secteurs de livraison</h1>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 flex items-center gap-1"><RefreshCw className="w-4 h-4" />Actualiser</button>
          <button onClick={retag} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">Recalculer les commandes du jour</button>
        </div>
      </div>
      <OpsNav />
      {flash && <div className="rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm px-3 py-2">{flash}</div>}
      <p className="text-sm text-gray-500">
        Un secteur est un polygone de points <code>[latitude, longitude]</code>. Une commande reçoit le secteur dont le polygone contient son point GPS ; sans GPS (ou hors polygone), le quartier
        est comparé au NOM du secteur : écrivez les quartiers séparés par « / » (ex. <em>Maârif / Gauthier</em>). Un secteur lié à un hub ne s&apos;applique qu&apos;aux commandes de ce hub.
        {res && res.untagged > 0 && <span className="text-amber-700"> {res.untagged} commande(s) du jour sans secteur.</span>}
      </p>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left"><tr><th className="p-2">Code</th><th className="p-2">Nom</th><th className="p-2">Hub</th><th className="p-2 text-right">Points</th><th className="p-2 text-right">Cmd jour</th><th className="p-2" /></tr></thead>
            <tbody>
              {res?.sectors.map(s => (
                <tr key={s.id} className={`border-t border-gray-100 ${f.id === s.id ? 'bg-purple-50' : ''} ${s.active ? '' : 'opacity-50'}`}>
                  <td className="p-2 font-mono font-medium"><button onClick={() => edit(s)} className="text-purple-700 hover:underline">{s.code}</button></td>
                  <td className="p-2">{s.name}</td><td className="p-2">{s.hubCode ?? 'Tous'}</td>
                  <td className="p-2 text-right">{s.polygon.length || '—'}</td><td className="p-2 text-right">{s.ordersToday}</td>
                  <td className="p-2 text-right"><button onClick={() => del(s)} aria-label={`Supprimer ${s.code}`} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
              {res && !res.sectors.length && <tr><td colSpan={6} className="p-6 text-center text-gray-400">Aucun secteur. Créez-en un à droite.</td></tr>}
              {!res && <tr><td colSpan={6} className="p-6 text-center text-gray-400">Chargement…</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-semibold text-gray-800">{f.id ? `Modifier ${f.code}` : 'Nouveau secteur'}</h2>{f.id && <button onClick={() => setF(EMPTY)} className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"><Plus className="w-3 h-3" />Nouveau</button>}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500">Code<input value={f.code} onChange={e => setF({ ...f, code: e.target.value })} placeholder="NORD-1" className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900 uppercase" /></label>
            <label className="text-xs text-gray-500">Hub (facultatif)
              <select value={f.hubCode} onChange={e => setF({ ...f, hubCode: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900">
                <option value="">Tous les hubs</option>{res?.hubs.map(h => <option key={h.code} value={h.code}>{h.name}</option>)}
              </select>
            </label>
          </div>
          <label className="text-xs text-gray-500 block">Nom (ou quartiers séparés par « / »)<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Maârif / Gauthier" className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900" /></label>
          <label className="text-xs text-gray-500 block">Polygone — une ligne « lat, lng » par point, ou JSON [[lat,lng],…]
            <textarea value={f.polygon} onChange={e => setF({ ...f, polygon: e.target.value })} rows={6} spellCheck={false} placeholder={'33.58, -7.65\n33.58, -7.60\n33.55, -7.60\n33.55, -7.65'} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-mono text-gray-900" />
          </label>
          <div className="text-xs">{f.polygon.trim() ? (poly ? <span className="text-green-700">{poly.length} points valides</span> : <span className="text-red-600">Polygone invalide (3 points minimum, coordonnées valides)</span>) : <span className="text-gray-400">Sans polygone : le secteur ne sert que pour le repli par quartier</span>}</div>
          <Preview current={poly} others={res?.sectors.filter(s => s.id !== f.id) ?? []} hubs={res?.hubs ?? []} />
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600 flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} />Actif</label>
            <button onClick={save} disabled={busy || !f.code.trim() || !f.name.trim() || (!!f.polygon.trim() && !poly)} className="px-4 py-1.5 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1"><Save className="w-4 h-4" />Enregistrer</button>
          </div>
          <p className="text-[11px] text-gray-400">Violet : secteur en cours · gris : autres secteurs · vert : hubs.</p>
        </div>
      </div>
    </div>
  )
}
