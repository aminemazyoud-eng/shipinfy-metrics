'use client'
import { useState, useEffect, useCallback } from 'react'
import { Calculator, Download } from 'lucide-react'
import OpsNav from '../components/OpsNav'
import KpiBand from './components/KpiBand'
import DimensionTable from './components/DimensionTable'
import AnomaliesList from './components/AnomaliesList'
import SimulatorPanel from './components/SimulatorPanel'
import ParamsPanel from './components/ParamsPanel'
import KmEntry from './components/KmEntry'
import type { CostingRes, Anomaly } from './components/types'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const DIMS = [['day', 'Jour'], ['vehicle', 'Véhicule'], ['driver', 'Chauffeur'], ['hub', 'Hub'], ['slot', 'Créneau'], ['month', 'Mois']] as const
type Tab = 'analyse' | 'simulateur' | 'parametres'

// Opérations → Chiffrage : coût par commande (chauffeur, helper, charges, carburant, entretien, véhicule, SI), marge, écarts vs objectif,
// anomalies et simulateur. Les valeurs déduites (et non mesurées) sont badgées « estimé ».
export default function ChiffragePage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86_400_000))); const [to, setTo] = useState(iso(new Date()))
  const [hub, setHub] = useState(''); const [dim, setDim] = useState<(typeof DIMS)[number][0]>('day'); const [tab, setTab] = useState<Tab>('analyse')
  const [hubs, setHubs] = useState<{ code: string; name: string }[]>([])
  const [drivers, setDrivers] = useState<{ code: string; name: string }[]>([])
  const [data, setData] = useState<CostingRes | null>(null); const [anoms, setAnoms] = useState<Anomaly[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ops/hubs').then(r => r.ok ? r.json() : null).then(j => j && setHubs(j.hubs)).catch(() => {})
    fetch('/api/rh/people?type=chauffeur').then(r => r.ok ? r.json() : null).then(j => j && setDrivers(j.people.map((p: { code: string; firstName: string; lastName: string }) => ({ code: p.code, name: `${p.firstName} ${p.lastName}` })))).catch(() => {})
  }, [])
  const qs = useCallback((extra = '') => `from=${from}&to=${to}${hub ? `&hub=${hub}` : ''}${extra}`, [from, to, hub])
  const load = useCallback(() => {
    setErr(null)
    fetch(`/api/ops/costing?${qs(`&groupBy=${dim}`)}`).then(async r => { if (r.ok) setData(await r.json()); else { setData(null); setErr((await r.json().catch(() => ({}))).error ?? 'Accès refusé ou erreur serveur') } }).catch(() => setErr('Erreur réseau'))
    fetch(`/api/ops/costing/anomalies?${qs()}`).then(r => r.ok ? r.json() : null).then(j => setAnoms(j ? j.anomalies : [])).catch(() => setAnoms([]))
  }, [qs, dim])
  useEffect(() => { load() }, [load])

  const dimLabel = DIMS.find(d => d[0] === dim)?.[1] ?? ''
  const tabBtn = (t: Tab, label: string) => <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-sm rounded-lg border ${tab === t ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-300'}`}>{label}</button>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Calculator className="w-5 h-5 text-purple-600" />Chiffrage — coût par commande</h1>
      <OpsNav />
      <div className="flex gap-2 flex-wrap">{tabBtn('analyse', 'Analyse')}{tabBtn('simulateur', 'Simulateur')}{tabBtn('parametres', 'Paramètres')}</div>

      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500">au<input type="date" value={to} onChange={e => setTo(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500">Hub<select value={hub} onChange={e => setHub(e.target.value)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white w-44"><option value="">Tous les hubs</option>{hubs.map(h => <option key={h.code} value={h.code}>{h.name.replace('Marjane ', '')}</option>)}</select></label>
        <label className="text-xs text-gray-500">Regrouper par<select value={dim} onChange={e => setDim(e.target.value as typeof dim)} className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white w-36">{DIMS.map(d => <option key={d[0]} value={d[0]}>{d[1]}</option>)}</select></label>
        <a href={`/api/ops/costing?${qs(`&groupBy=${dim}&format=xlsx`)}`} className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-purple-600 text-white"><Download className="w-4 h-4" />Export Excel</a>
      </div>
      {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}

      {tab === 'analyse' && (<>
        <KpiBand data={data} />
        {data && (
          <div className="text-xs text-gray-500 space-y-0.5">
            <div>Source de la paie : {data.meta.paySource}. {data.summary.estimated ? <b className="text-amber-700">{Math.round(data.summary.estimatedCostPct)} % du coût est estimé ({data.summary.estimatedParts.join(', ')}).</b> : 'Toutes les valeurs sont mesurées.'}</div>
            {data.meta.deliveredWithoutTeam > 0 && <div className="text-amber-700">{data.meta.deliveredWithoutTeam} commande(s) livrée(s) sans livreur affecté dans Shipinfy : exclues du calcul.</div>}
            {data.targets.pricePerOrder <= 0 && <div>Prix facturé non renseigné : renseignez-le dans l&apos;onglet Paramètres pour obtenir la marge.</div>}
          </div>
        )}
        <DimensionTable data={data} dimLabel={dimLabel} />
        <AnomaliesList items={anoms} />
        <KmEntry drivers={drivers} onSaved={load} />
        <div className="text-xs text-gray-400">Coût / commande = (chauffeur + helper + charges patronales + carburant + entretien + véhicule + équipement SI) ÷ commandes livrées. Écart : <span className="text-green-700">vert</span> ≤ cible haute · <span className="text-amber-700">ambre</span> ≤ +10 % · <span className="text-red-700">rouge</span> au-delà. Pour les regroupements par hub et par créneau, le coût d&apos;une journée-équipe est réparti au prorata des commandes.</div>
      </>)}
      {tab === 'simulateur' && <SimulatorPanel />}
      {tab === 'parametres' && <ParamsPanel onSaved={load} />}
    </div>
  )
}
