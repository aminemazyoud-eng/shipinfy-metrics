'use client'
// Dashboard « Control Tower » — 8 onglets (Vue générale, Créneaux & ponctualité, Lead Times, Livreurs, Géographie,
// Clients & récurrence, Valeur déclarée, Qualité des données). Mêmes cas d'usage, mêmes cartes KPI et mêmes règles
// de calcul que le HTML de référence (docs/dashboard-reference), mais alimenté par l'API du back-office
// (GET /api/ops/bi/orders) au lieu d'un export CSV. Les rapports planifiés restent dans /rapports.
// Ancienne page : /dashboard-legacy (route de secours).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Printer, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { addDays, localToday } from '@/lib/tz'
import { DEFAULT_SEL, hubsOf, makeLocal, n, prepBi, type BiRaw, type Sel, type TzMode } from '@/lib/ops-bi'
import { ClientsTab, DriversTab, GeoTab, LeadTab, OverviewTab, QualityTab, SlotsTab, ValueTab } from '@/components/bi/BiTabs'

const TABS = [
  ['overview', 'Vue générale'], ['slots', 'Créneaux & ponctualité'], ['lead', 'Lead Times'], ['drivers', 'Livreurs'],
  ['geo', 'Géographie'], ['clients', 'Clients & récurrence'], ['value', 'Valeur déclarée'], ['quality', 'Qualité des données'],
] as const
type TabKey = (typeof TABS)[number][0]

interface Payload { rows: BiRaw[]; truncated: boolean; source: string; lastSync: string | null; from: string; to: string }
const REFRESH_MS = 5 * 60_000 // la synchro back-office tourne toutes les 5 minutes

export default function ControlTowerPage() {
  const today = localToday()
  const [from, setFrom] = useState(addDays(today, -29))
  const [to, setTo] = useState(today)
  // UTC+1 par défaut, comme le HTML de référence (fuseau du Maroc hors Ramadan). « auto » s'appuie sur la base IANA du navigateur,
  // qui peut différer de celle du serveur : à n'utiliser qu'en connaissance de cause (Ramadan).
  const [tz, setTz] = useState<TzMode>('1')
  const [tab, setTab] = useState<TabKey>('overview')
  const [sel, setSelState] = useState<Sel>({ ...DEFAULT_SEL, start: addDays(today, -29), end: today })
  const [hub, setHub] = useState(''), [slot, setSlot] = useState(''), [status, setStatus] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState<Date | null>(null)

  const set = useCallback((p: Partial<Sel>) => setSelState(s => ({ ...s, ...p })), [])
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

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
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
  const inp = 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-[#17243a]'

  return (
    <div className="min-h-screen bg-[#f5f7fb] pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-[#142640] px-4 py-3 text-white md:px-6 print:hidden">
        <div>
          <strong className="text-base">AS OPERATIONS <span className="font-normal text-[#80bacf]">/ Control Tower</span></strong>
          <p className="text-xs text-slate-300">Tableau de bord opérationnel · Livraison programmée Last Mile</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#1d3a5f] px-3 py-1 text-[11px] font-semibold tracking-wide">V4.0 · API BACK-OFFICE</span>
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${ok ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'}`}>
            {ok ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{ok ? 'Connecté' : 'Indisponible'}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-4 px-3 py-4 md:px-6">
        {/* Source de données */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm print:hidden">
          <div>
            <strong className="text-sm text-[#17243a]">Source de données</strong>
            <p className="text-xs text-slate-500">Les commandes viennent de l’API du back-office Shipinfy (synchronisation automatique) — aucun fichier à importer.</p>
            <p className="mt-1 text-xs font-medium text-slate-600">
              {data ? <>Source : {data.source} · {n(data.rows.length)} commandes chargées{updated && <> · mis à jour à {updated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}{data.lastSync && <> · dernière synchro {new Date(data.lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</>}</> : 'Chargement…'}
            </p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
          </button>
        </div>

        {/* Filtres */}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm print:hidden">
          <label className="text-[11px] font-semibold text-slate-500">Date de début<input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} className={`${inp} mt-1 block`} /></label>
          <label className="text-[11px] font-semibold text-slate-500">Date de fin<input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} className={`${inp} mt-1 block`} /></label>
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            {[[7, '7 j'], [30, '30 j'], [90, '90 j']].map(([d, l]) => <button key={d} onClick={() => preset(d as number)} className="px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">{l}</button>)}
          </div>
          <label className="text-[11px] font-semibold text-slate-500">Granularité
            <select value={sel.grain} onChange={e => set({ grain: e.target.value as Sel['grain'] })} className={`${inp} mt-1 block`}><option value="day">Jour</option><option value="week">Semaine</option><option value="month">Mois</option></select></label>
          <label className="text-[11px] font-semibold text-slate-500">Magasin
            <select value={hub} onChange={e => setHub(e.target.value)} className={`${inp} mt-1 block`}><option value="">Tous les magasins</option>{hubs.map(h => <option key={h}>{h}</option>)}</select></label>
          <label className="text-[11px] font-semibold text-slate-500">Créneau
            <select value={slot} onChange={e => setSlot(e.target.value)} className={`${inp} mt-1 block`}><option value="">Tous</option><option>09h–12h</option><option>12h–15h</option><option>15h–18h</option><option>18h–21h</option><option value="atypical">Atypique</option></select></label>
          <label className="text-[11px] font-semibold text-slate-500">Statut
            <select value={status} onChange={e => setStatus(e.target.value)} className={`${inp} mt-1 block`}><option value="">Tous les statuts</option>{statuses.map(s => <option key={s}>{s}</option>)}</select></label>
          <label className="text-[11px] font-semibold text-slate-500">Fuseau d’affichage / lecture des créneaux
            <select value={tz} onChange={e => setTz(e.target.value as TzMode)} className={`${inp} mt-1 block`}><option value="1">UTC+1 (Maroc, hors Ramadan)</option><option value="0">UTC+0 (horaires bruts / Ramadan)</option><option value="auto">Casablanca (automatique, selon le navigateur)</option></select></label>
          <button onClick={() => { setHub(''); setSlot(''); setStatus(''); preset(30) }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Réinitialiser</button>
        </div>

        {/* Onglets */}
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <nav className="flex flex-wrap gap-1.5">
            {TABS.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${tab === k ? 'bg-[#142640] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{label}</button>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-xs font-semibold text-slate-600">
            <span>Rapport · {TABS.find(t => t[0] === tab)![1]}</span>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 hover:bg-slate-50"><Printer className="h-3.5 w-3.5" /> Imprimer / PDF</button>
          </div>
        </div>

        {data?.truncated && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Période très volumineuse : seules les premières commandes sont chargées. Réduisez la période pour des chiffres complets.</div>}
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Impossible de charger les données : {error} <button onClick={load} className="ml-2 underline">Réessayer</button></div>}
        {!error && loading && !data && <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500"><div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />Chargement des commandes…</div>}
        {data && !rows.length && !loading && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Aucune commande sur cette période et ces filtres.<br /><small className="text-xs">Vérifiez la synchronisation du back-office (Paramètres › Intégrations) ou élargissez la période.</small>
          </div>
        )}

        {/* Contenu de l'onglet actif (calculé uniquement pour l'onglet affiché) */}
        {data && rows.length > 0 && (
          <div className="print:block">
            <div className="hidden print:block mb-2 text-xs"><strong>AS OPERATIONS · {TABS.find(t => t[0] === tab)![1]}</strong> — Période : {from} au {to} · Magasin : {hub || 'Tous'}</div>
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
      </main>
    </div>
  )
}
