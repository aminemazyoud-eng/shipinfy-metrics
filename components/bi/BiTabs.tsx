'use client'
// Les 8 onglets du Control Tower : mêmes cas d'usage, mêmes cartes KPI, mêmes tableaux que le HTML de référence.
import { Fragment, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  overviewData, slotsData, leadData, driversData, geoData, clientsData, valueData, qualityData, hubsOf, dur, n,
  type BiRow, type Grain, type LocalFn, type Sel,
} from '@/lib/ops-bi'
import { BarsChart, DataTable, HubSelect, MetricCards, Panel, Select } from './BiUi'

const GeoMap = dynamic(() => import('./GeoMap'), { ssr: false, loading: () => <div className="h-[460px] animate-pulse rounded-lg bg-slate-100" /> })

interface TabProps { rows: BiRow[]; base: BiRow[]; sel: Sel; set: (p: Partial<Sel>) => void; lp: LocalFn }
const GRAINS: [Grain, string][] = [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']]
const grid2 = 'grid grid-cols-1 gap-4 xl:grid-cols-2'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ── 1 · Vue générale ──
export function OverviewTab({ rows, sel, set, lp }: TabProps) {
  const d = overviewData(rows, sel, lp), hubs = hubsOf(rows)
  return (
    <div className="space-y-4">
      <MetricCards cards={d.metrics} />
      <div className="flex flex-wrap gap-2">
        {d.statusChips.map(c => (
          <div key={c.status} className={`rounded-lg border px-3 py-1.5 text-xs ${c.good ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
            <span className="font-semibold">{c.status}</span> <b className="ml-1">{n(c.count)}</b> <small className="ml-1 opacity-70">{c.share}</small>
          </div>
        ))}
      </div>
      <div className={grid2}>
        <Panel title="Évolution des commandes" controls={<Select value={sel.volumeGrain} onChange={v => set({ volumeGrain: v })} options={GRAINS} />}><BarsChart data={d.volume} rotate /></Panel>
        <Panel title="Répartition par magasin"><BarsChart data={d.hubBars} color="#079c85" horizontal denom={d.hubDenom} /></Panel>
      </div>
      <div className={grid2}>
        <Panel title="Activité par jour de semaine × Magasin" controls={<Select value={sel.weekdayMetric} onChange={v => set({ weekdayMetric: v })} options={[['total', 'Total'], ['average', 'Moyenne par jour'], ['share', 'Part (%)']]} />}>
          <BarsChart data={d.weekday.series} share={d.weekday.share} format={sel.weekdayMetric === 'average' ? v => v.toFixed(1).replace('.', ',') : undefined} />
          <div className="mt-3"><DataTable t={d.weekday.table} maxH="max-h-72" /></div>
        </Panel>
        <Panel title="Heures de transmission des commandes préparées" controls={<HubSelect value={sel.prepHub} onChange={v => set({ prepHub: v })} hubs={hubs} />}>
          <BarsChart data={d.prepHour.series} denom={d.prepHour.denom} compactLabels />
          <div className="mt-3"><DataTable t={d.prepHour.table} maxH="max-h-72" /></div>
        </Panel>
      </div>
      <Panel title="Tableau croisé · Magasin × Période" controls={<><Select value={sel.grain} onChange={v => set({ grain: v })} options={GRAINS} /><button onClick={() => download('ops_tcd_commandes.csv', d.pivotCsv)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Exporter ce tableau</button></>} wide>
        <DataTable t={d.pivot} />
      </Panel>
    </div>
  )
}

// ── 2 · Créneaux & ponctualité ──
export function SlotsTab({ base, sel, set }: TabProps) {
  const d = slotsData(base, sel), hubs = hubsOf(base), pick = (k: keyof Sel) => <HubSelect value={sel[k] as string} onChange={v => set({ [k]: v })} hubs={hubs} />
  return (
    <div className="space-y-4">
      <MetricCards cards={d.metrics} />
      <div className={grid2}>
        <Panel title="Commandes par créneau · volumes et parts" controls={pick('slotHub')}><BarsChart data={d.slotChart} denom={d.slotDenom} /></Panel>
        <Panel title="Respect des créneaux · livrées classifiables" controls={pick('onTimeHub')}><BarsChart data={d.ontimeChart} color="#079c85" denom={d.ontimeDenom} /></Panel>
      </div>
      <Panel title="Créneaux par magasin · volumes et %" wide><DataTable t={d.slotTable} /></Panel>
      <div className={grid2}>
        <Panel title="Paliers de retard" hint={d.lateExplain} controls={pick('lateHub')}><DataTable t={d.lateTable} /></Panel>
        <Panel title="Statut × tentatives de livraison" controls={pick('attemptHub')}><DataTable t={d.attemptTable} /></Panel>
      </div>
      <Panel title="Détails par magasin · retards et tentatives" wide><DataTable t={d.slotHubDetail} /></Panel>
      <Panel title="Paliers de retard × Magasin · n (%)" wide><DataTable t={d.lateCross} /></Panel>
      <Panel title="Retards et nombre de tentatives" controls={pick('attemptLateHub')} wide><DataTable t={d.attemptLateTable} /></Panel>
    </div>
  )
}

// ── 3 · Lead Times ──
export function LeadTab({ rows, sel, set }: TabProps) {
  const d = leadData(rows, sel), hubs = hubsOf(rows), pick = (k: keyof Sel) => <HubSelect value={sel[k] as string} onChange={v => set({ [k]: v })} hubs={hubs} />
  const [open, setOpen] = useState<number | null>(null)
  const md = open !== null ? d.maxDetail[open] : null
  const stamp = (ts: number) => (Number.isFinite(ts) ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'Absent')
  return (
    <div className="space-y-4">
      <MetricCards cards={d.metrics} />
      <Panel title="Délais par magasin · heures et minutes" wide><DataTable t={d.leadTable} /></Panel>
      <div className={grid2}>
        <Panel title="Distribution des délais" controls={pick('leadHub')}>
          <DataTable t={d.leadDist} maxH="max-h-80" />
          <div className="mt-2 flex flex-wrap gap-2">
            {d.maxDetail.map((m, i) => m && <button key={i} onClick={() => setOpen(open === i ? null : i)} className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50">Max {i + 1} : {dur(m.max)} ▸ commande</button>)}
          </div>
          {md && (
            <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-slate-700">
              <b>{md.step} — commande {md.id}</b>
              <p>Magasin : {md.hub} · Délai : {dur(md.max)}</p>
              <p>{md.a} : {stamp(md.aTs)} · {md.b} : {stamp(md.bTs)}</p>
            </div>
          )}
        </Panel>
        <Panel title="Transmission de la commande par rapport au créneau promis" controls={pick('anticipationHub')}><DataTable t={d.anticipationTable} /></Panel>
      </div>
      <Panel title="Diagnostic des délais non calculables" hint="Une commande peut manquer plusieurs étapes ; les lignes ne sont donc pas additionnables." wide><DataTable t={d.leadIssues} maxH="max-h-72" /></Panel>
      <Panel title="Lead Times × Créneau commercial" controls={pick('leadSlotHub')} wide><DataTable t={d.leadSlots} /></Panel>
    </div>
  )
}

// ── 4 · Livreurs ──
export function DriversTab({ base, sel, set }: TabProps) {
  const d = driversData(base, sel)
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setOpenKeys(s => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x })
  return (
    <div className="space-y-4">
      <MetricCards cards={d.metrics} />
      <Panel title="Productivité des livreurs" controls={<Select value={sel.driverView} onChange={v => set({ driverView: v })} options={[['driver', 'Livreur › Magasin'], ['hub', 'Magasin › Livreur']]} />} wide>
        <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-100">
          <table className="w-full min-w-max text-[12px]">
            <thead className="sticky top-0 z-10 bg-slate-50"><tr>{d.head.map((h, i) => <th key={i} className={`whitespace-nowrap border-b border-slate-200 px-2.5 py-2 text-[11px] font-semibold text-slate-600 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {d.groups.map(g => (
                <Fragment key={g.key}>
                  <tr className="hover:bg-blue-50/40">
                    <td className="whitespace-nowrap border-b border-slate-100 px-2.5 py-1.5 text-left font-medium"><button onClick={() => toggle(g.key)} className="text-blue-700">{openKeys.has(g.key) ? '▾' : '▸'} {g.label}</button></td>
                    {g.cells.map((c, i) => <td key={i} className="whitespace-nowrap border-b border-slate-100 px-2.5 py-1.5 text-right tabular-nums">{c}</td>)}
                  </tr>
                  {openKeys.has(g.key) && g.children.map((ch, ci) => (
                    <tr key={g.key + ci} className="bg-slate-50/70">
                      <td className="whitespace-nowrap border-b border-slate-100 py-1.5 pl-7 pr-2.5 text-left text-slate-600">↳ {ch.label}</td>
                      {ch.cells.map((c, i) => <td key={i} className="whitespace-nowrap border-b border-slate-100 px-2.5 py-1.5 text-right tabular-nums text-slate-600">{c}</td>)}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Performance détaillée par livreur" wide controls={<>
        <select value={sel.driverSelect} onChange={e => set({ driverSelect: e.target.value })} className="max-w-[240px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
          <option value="">Tous les livreurs</option>{d.options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <Select value={sel.driverDetailMode} onChange={v => set({ driverDetailMode: v })} options={[['hub', 'Par magasin'], ['day', 'Par jour'], ['slot', 'Par créneau']]} />
      </>}><DataTable t={d.detail} /></Panel>
    </div>
  )
}

// ── 5 · Géographie ──
export function GeoTab({ rows, sel, set }: TabProps) {
  const d = geoData(rows, sel), hubs = hubsOf(rows)
  const [mode, setMode] = useState<'dots' | 'density' | 'late'>('dots')
  const [tiles, setTiles] = useState(false)
  return (
    <div className="space-y-4">
      <MetricCards cards={d.metrics} />
      <Panel title="Carte des livraisons et retards" controls={<>
        <Select value={mode} onChange={setMode} options={[['dots', 'Livraisons (points)'], ['density', 'Densité'], ['late', 'Taux de retard']]} />
        <button onClick={() => setTiles(t => !t)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${tiles ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{tiles ? 'Fond cartographique activé' : 'Activer le fond cartographique'}</button>
      </>} hint="Le fond cartographique (OpenStreetMap) n'est chargé que sur demande ; sans lui, seuls les points et les magasins s'affichent.">
        <GeoMap points={d.points} stores={d.stores} mode={mode} tiles={tiles} />
      </Panel>
      <div className={grid2}>
        <Panel title="Distance magasin → client" controls={<HubSelect value={sel.geoHub} onChange={v => set({ geoHub: v })} hubs={hubs} />}>
          <BarsChart data={d.series} horizontal denom={d.denom} />
          <div className="mt-3"><DataTable t={d.distanceTable} maxH="max-h-64" /></div>
        </Panel>
        <Panel title="Distances par magasin"><DataTable t={d.distanceHub} /></Panel>
      </div>
    </div>
  )
}

// ── 6 · Clients & récurrence ──
export function ClientsTab({ rows, sel, set }: TabProps) {
  const d = clientsData(rows, sel), hubs = hubsOf(rows)
  return (
    <div className="space-y-4">
      <MetricCards cards={d.metrics} />
      <div className={grid2}>
        <Panel title="Fréquence de commande sur la période" controls={<HubSelect value={sel.clientHub} onChange={v => set({ clientHub: v })} hubs={hubs} />}><BarsChart data={d.series} color="#079c85" /></Panel>
        <Panel title="Distribution de la récurrence" controls={<HubSelect value={sel.clientTableHub} onChange={v => set({ clientTableHub: v })} hubs={hubs} />}><DataTable t={d.clientTable} maxH="max-h-80" /></Panel>
      </div>
      <Panel title="Récurrence × Magasin · n (%)" wide><DataTable t={d.clientCross} /></Panel>
      <Panel title="Clients à forte fréquence · 20 commandes ou plus" wide><DataTable t={d.topClients} maxH="max-h-80" empty="Aucun client dans cette catégorie." /></Panel>
      <Panel title="Clients à forte fréquence · 10 à 19 commandes" wide><DataTable t={d.midClients} maxH="max-h-80" empty="Aucun client dans cette catégorie." /></Panel>
    </div>
  )
}

// ── 7 · Valeur déclarée ──
export function ValueTab({ rows, sel, set }: TabProps) {
  const d = valueData(rows, sel), hubs = hubsOf(rows)
  const mad = (v: number) => new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  return (
    <div className="space-y-4">
      <MetricCards cards={d.metrics} />
      <div className={grid2}>
        <Panel title="Évolution de la valeur déclarée" controls={<><HubSelect value={sel.valueHub} onChange={v => set({ valueHub: v })} hubs={hubs} /><Select value={sel.valueGrain} onChange={v => set({ valueGrain: v })} options={GRAINS} /></>}><BarsChart data={d.evolution} rotate format={mad} /></Panel>
        <Panel title="Valeur par magasin"><BarsChart data={d.hubChart} color="#079c85" horizontal denom={d.hubDenom} /><div className="mt-3"><DataTable t={d.hubTable} maxH="max-h-64" /></div></Panel>
      </div>
      <Panel title="Valeur par créneau" controls={<HubSelect value={sel.valueSlotHub} onChange={v => set({ valueSlotHub: v })} hubs={hubs} />} wide>
        <div className={grid2}><BarsChart data={d.slotChart} denom={d.slotDenom} /><DataTable t={d.slotTable} maxH="max-h-72" /></div>
      </Panel>
      <Panel title="Tableau croisé · Valeur × Période" wide><DataTable t={d.pivot} /></Panel>
    </div>
  )
}

// ── 8 · Qualité des données ──
export function QualityTab({ rows, source }: TabProps & { source: { name: string; lastSync: string | null } }) {
  const d = qualityData(rows, source)
  return (
    <div className="space-y-4">
      <MetricCards cards={d.metrics} />
      <Panel title="Contrôles de cohérence" wide><DataTable t={d.table} /></Panel>
      <Panel title="Règles de calcul" wide>
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
          <li>Créneaux standard : 09h–12h, 12h–15h, 15h–18h, 18h–21h (tolérance 15 min sur le début, durée 2 h 30 à 3 h 30) ; tout le reste est « atypique ».</li>
          <li>Ponctualité : calculée sur les commandes DELIVERED, livraison comparée au début et à la fin réels du créneau promis (avance / à l’heure / retard).</li>
          <li>Lead times : LT1 création → assignation, LT2 assignation → transport, LT3 transport → début de livraison, LT4 début → livraison (LT4 uniquement si livrée).</li>
          <li>Distance : à vol d’oiseau (haversine) entre le magasin et l’adresse du client ; absente si un des deux GPS manque.</li>
          <li>Récurrence : numéros de mobile uniques ; un client est récurrent à partir de 2 commandes sur la période.</li>
          <li>Les données proviennent de l’API du back-office Shipinfy (synchronisation toutes les 5 minutes), sans import de fichier.</li>
        </ul>
      </Panel>
    </div>
  )
}
