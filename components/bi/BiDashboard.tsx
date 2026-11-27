'use client'
// Dashboard « Control Tower » : un sous-module par vue (Vue générale, Créneaux & ponctualité, Lead Times, Livreurs, Géographie,
// Clients & récurrence, Valeur déclarée, Qualité des données). Mêmes cas d'usage, mêmes cartes KPI et mêmes règles de calcul que
// le HTML de référence (docs/dashboard-reference), alimenté par l'API du back-office (GET /api/ops/bi/orders) au lieu d'un CSV.
// La navigation entre vues est assurée par la barre de sous-modules (lib/module-nav.ts) ; les filtres sont conservés d'une vue à l'autre.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, FileDown, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { addDays, localToday } from '@/lib/tz'
import { biTab, type BiTabKey } from '@/lib/bi-tabs'
import { DEFAULT_SEL, hubsOf, makeLocal, n, prepBi, type BiRaw, type Sel, type TzMode } from '@/lib/ops-bi'
import { ClientsTab, DriversTab, GeoTab, LeadTab, OverviewTab, QualityTab, SlotsTab, ValueTab } from './BiTabs'

interface Payload { rows: BiRaw[]; truncated: boolean; source: string; lastSync: string | null; from: string; to: string }
interface Saved { from: string; to: string; tz: TzMode; grain: Sel['grain']; hub: string; slot: string; status: string }

const REFRESH_MS = 5 * 60_000 // la synchro back-office tourne toutes les 5 minutes
const STORE = 'bi-filters'

export default function BiDashboard({ tab }: { tab: BiTabKey }) {
  const meta = biTab(tab)
  const today = localToday()
  const [from, setFrom] = useState(addDays(today, -29))
  const [to, setTo] = useState(today)
  // UTC+1 par défaut, comme le HTML de référence (fuseau du Maroc hors Ramadan). « auto » s'appuie sur la base IANA du navigateur,
  // qui peut différer de celle du serveur : à n'utiliser qu'en connaissance de cause (Ramadan).
  const [tz, setTz] = useState<TzMode>('1')
  const [sel, setSelState] = useState<Sel>({ ...DEFAULT_SEL, start: addDays(today, -29), end: today })
  const [hub, setHub] = useState(''), [slot, setSlot] = useState(''), [status, setStatus] = useState('')
  const [ready, setReady] = useState(false)
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState<Date | null>(null)

  const set = useCallback((p: Partial<Sel>) => setSelState(s => ({ ...s, ...p })), [])

  // Restaure les filtres de la vue précédente (sessionStorage) avant le premier chargement
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE)
      if (raw) {
        const s = JSON.parse(raw) as Partial<Saved>
        if (s.from && s.to) { setFrom(s.from); setTo(s.to) }
        if (s.tz) setTz(s.tz)
        if (s.grain) setSelState(x => ({ ...x, grain: s.grain! }))
        setHub(s.hub ?? ''); setSlot(s.slot ?? ''); setStatus(s.status ?? '')
      }
    } catch { /* stockage indisponible : filtres par défaut */ }
    setReady(true)
  }, [])
  useEffect(() => {
    if (!ready) return
    try { sessionStorage.setItem(STORE, JSON.stringify({ from, to, tz, grain: sel.grain, hub, slot, status } satisfies Saved)) } catch { /* ignore */ }
  }, [ready, from, to, tz, sel.grain, hub, slot, status])
  useEffect(() => { set({ start: from, end: to }) }, [from, to, set])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/ops/bi/orders?from=${from}&to=${to}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j as Payload); setError(null); setUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement')
    } finally { setLoading(false) }
  }, [from, to])

  useEffect(() => { if (!ready) return; const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load, ready])
  useEffect(() => { const t = setInterval(load, REFRESH_MS); return () => clearInterval(t) }, [load])

  const lp = useMemo(() => makeLocal(tz), [tz])
  const all = useMemo(() => (data?.rows ?? []).map(r => prepBi(r, lp)), [data, lp])
  const inPeriod = useMemo(() => all.filter(r => (!from || r.day >= from) && (!to || r.day <= to)), [all, from, to])
  const base = useMemo(() => inPeriod.filter(r => (!hub || r.hub === hub) && (!slot || r.slot === slot)), [inPeriod, hub, slot])
  const rows = useMemo(() => base.filter(r => !status || r.status === status), [base, status])
  const hubs = useMemo(() => hubsOf(inPeriod), [inPeriod])
  const statuses = useMemo(() => [...new Set(inPeriod.map(r => r.status))].sort(), [inPeriod])

  const preset = (days: number) => { setFrom(addDays(today, -(days - 1))); setTo(today) }
  const props = { rows, base, sel, set, lp }
  const source = { name: data?.source ?? '—', lastSync: data?.lastSync ?? null }
  const ok = !error && !!data
  const inp = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800'
  const lbl = 'text-[11px] font-semibold text-gray-500'

  return (
    <div className="min-h-screen bg-gray-50 p-3 pb-10 md:p-4 lg:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4 lg:space-y-5">

        {/* En-tête de page (charte Shipinfy Metrics) */}
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 shadow lg:h-10 lg:w-10">
              <BarChart3 className="h-4 w-4 text-white lg:h-5 lg:w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 lg:text-xl">{meta.label}</h1>
              <p className="text-xs text-gray-500 lg:text-sm">{meta.subtitle}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {ok ? <><Wifi className="h-3.5 w-3.5" /> Connecté</> : <><WifiOff className="h-3.5 w-3.5" /> Indisponible</>}
            </div>
            {updated && <span className="text-xs text-gray-400">Mis à jour à {updated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
            </button>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700">
              <FileDown className="h-3.5 w-3.5" /> Exporter cet écran en PDF
            </button>
          </div>
        </div>

        {/* Source de données */}
        <div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm print:hidden">
          <strong className="text-sm text-gray-900">Source de données</strong>
          <p className="text-xs text-gray-500">Les commandes viennent de l’API du back-office Shipinfy (synchronisation automatique) — aucun fichier à importer.</p>
          <p className="mt-1 text-xs font-medium text-gray-600">
            {data ? <>Source : {data.source} · {n(data.rows.length)} commandes chargées{data.lastSync && <> · dernière synchro {new Date(data.lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</>}</> : 'Chargement…'}
          </p>
        </div>

        {/* Filtres */}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm print:hidden">
          <label className={lbl}>Date de début<input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} className={`${inp} mt-1 block`} /></label>
          <label className={lbl}>Date de fin<input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} className={`${inp} mt-1 block`} /></label>
          <div className="flex overflow-hidden rounded-lg border border-gray-200">
            {[[7, '7 j'], [30, '30 j'], [90, '90 j']].map(([d, l]) => <button key={d} onClick={() => preset(d as number)} className="px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">{l}</button>)}
          </div>
          <label className={lbl}>Granularité
            <select value={sel.grain} onChange={e => set({ grain: e.target.value as Sel['grain'] })} className={`${inp} mt-1 block`}><option value="day">Jour</option><option value="week">Semaine</option><option value="month">Mois</option></select></label>
          <label className={lbl}>Magasin
            <select value={hub} onChange={e => setHub(e.target.value)} className={`${inp} mt-1 block`}><option value="">Tous les magasins</option>{hubs.map(h => <option key={h}>{h}</option>)}</select></label>
          <label className={lbl}>Créneau
            <select value={slot} onChange={e => setSlot(e.target.value)} className={`${inp} mt-1 block`}><option value="">Tous</option><option>09h–12h</option><option>12h–15h</option><option>15h–18h</option><option>18h–21h</option><option value="atypical">Atypique</option></select></label>
          <label className={lbl}>Statut
            <select value={status} onChange={e => setStatus(e.target.value)} className={`${inp} mt-1 block`}><option value="">Tous les statuts</option>{statuses.map(s => <option key={s}>{s}</option>)}</select></label>
          <label className={lbl}>Fuseau horaire
            <select value={tz} onChange={e => setTz(e.target.value as TzMode)} className={`${inp} mt-1 block`}><option value="1">UTC+1 (Maroc, hors Ramadan)</option><option value="0">UTC+0 (Ramadan / horaires bruts)</option><option value="auto">Casablanca (selon le navigateur)</option></select></label>
          <button onClick={() => { setHub(''); setSlot(''); setStatus(''); preset(30) }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Réinitialiser</button>
        </div>

        {data?.truncated && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Période très volumineuse : seules les premières commandes sont chargées. Réduisez la période pour des chiffres complets.</div>}
        {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">Impossible de charger les données : {error} <button onClick={load} className="ml-2 underline">Réessayer</button></div>}
        {!error && loading && !data && <div className="flex items-center justify-center gap-3 py-12 text-sm text-gray-500"><div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />Chargement des commandes…</div>}
        {data && !rows.length && !loading && (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Aucune commande sur cette période et ces filtres.<br /><small className="text-xs">Vérifiez la synchronisation du back-office (Paramètres › Intégrations) ou élargissez la période.</small>
          </div>
        )}

        {/* Contenu de la vue (calculé uniquement pour la vue affichée) */}
        {data && rows.length > 0 && (
          <div>
            <div className="mb-2 hidden text-xs print:block"><strong>{meta.label}</strong> — Période : {from} au {to} · Magasin : {hub || 'Tous'} · Fuseau : {tz === '0' ? 'UTC+0' : tz === '1' ? 'UTC+1' : 'Casablanca'}</div>
            {tab === 'overview' && <OverviewTab {...props} />}
            {tab === 'slots' && <SlotsTab {...props} />}
            {tab === 'lead' && <LeadTab {...props} />}
            {tab === 'drivers' && <DriversTab {...props} />}
            {tab === 'geo' && <GeoTab {...props} />}
            {tab === 'clients' && <ClientsTab {...props} />}
            {tab === 'value' && <ValueTab {...props} />}
            {tab === 'quality' && <QualityTab {...props} source={source} />}
          </div>
        )}
      </div>
    </div>
  )
}
