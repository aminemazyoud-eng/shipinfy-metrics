'use client'
import { useState, useMemo, useEffect } from 'react'
import { Minus, Plus, RotateCcw, Scale, Truck, ArrowRight } from 'lucide-react'
import type { ForecastResult, ForecastHub, Level, LiveResult } from '@/lib/ops-analytics'

const LEVEL_STYLE: Record<Level, string> = { vide: 'bg-gray-50 text-gray-300', ok: 'bg-green-50 text-green-800', tendu: 'bg-amber-100 text-amber-900', sature: 'bg-red-100 text-red-800 font-semibold' }
const BAR: Record<Level, string> = { vide: 'bg-gray-200', ok: 'bg-green-500', tendu: 'bg-amber-500', sature: 'bg-red-500' }

interface Cell { expected: number; known: number; capacity: number; load: number; level: Level; needed: number }
interface Row { h: ForecastHub; d: number; cells: Record<string, Cell>; peak: number; need: number; gap: number; surplus: number; sat: number; tense: number }

/**
 * Prévisions par créneau — simulation de capacité : +/− livreur par hub, borné par les livreurs réellement disponibles
 * dans la ville (on ne peut que déplacer, jamais « créer » un livreur). Les déplacements peuvent être appliqués pour de vrai.
 */
export default function ForecastBoard({ forecast, perDriver, resetKey, city, onApplied }: { forecast: ForecastResult; perDriver: number; resetKey: string; city: string; onApplied: () => void }) {
  const [adj, setAdj] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; s: string } | null>(null)
  useEffect(() => { setAdj({}); setMsg(null) }, [resetKey])

  const sim = useMemo(() => {
    const th = forecast.thresholds ?? { tense: 0.7, saturated: 1 }
    const lvl = (load: number, exp: number): Level => (exp === 0 ? 'vide' : load >= th.saturated ? 'sature' : load >= th.tense ? 'tendu' : 'ok')
    const rows: Row[] = forecast.hubs.map(h => {
      const d = Math.max(0, h.drivers + (adj[h.code] || 0)); const cells: Record<string, Cell> = {}
      let peak = 0, need = 0, sat = 0, tense = 0
      for (const s of forecast.slots) {
        const c = h.cells[s]; const capacity = d * perDriver; const load = capacity > 0 ? c.expected / capacity : c.expected > 0 ? 9.99 : 0
        const level = lvl(load, c.expected); const needed = Math.ceil(c.expected / perDriver)
        cells[s] = { expected: c.expected, known: c.known, capacity, load, level, needed }
        peak = Math.max(peak, c.expected); need = Math.max(need, needed); if (level === 'sature') sat++; else if (level === 'tendu') tense++
      }
      return { h, d, cells, peak, need, gap: Math.max(0, need - d), surplus: Math.max(0, d - need), sat, tense }
    })
    const totals: Record<string, { expected: number; capacity: number }> = {}
    for (const s of forecast.slots) totals[s] = { expected: rows.reduce((a, r) => a + r.cells[s].expected, 0), capacity: rows.reduce((a, r) => a + r.cells[s].capacity, 0) }
    // réserve de livreurs par ville : disponibles (base) − affectés (après simulation)
    const pool = new Map<string, { base: number; used: number }>()
    for (const r of rows) { const p = pool.get(r.h.city) ?? { base: 0, used: 0 }; p.base += r.h.drivers; p.used += r.d; pool.set(r.h.city, p) }
    return { rows, totals, pool, sat: rows.reduce((a, r) => a + r.sat, 0), tense: rows.reduce((a, r) => a + r.tense, 0), gap: rows.reduce((a, r) => a + r.gap, 0), surplus: rows.reduce((a, r) => a + r.surplus, 0) }
  }, [forecast, adj, perDriver])

  const changed = Object.values(adj).some(v => v !== 0)
  const free = (c: string) => { const p = sim.pool.get(c); return p ? p.base - p.used : 0 }
  const bump = (r: Row, delta: number) => {
    if (delta > 0 && free(r.h.city) <= 0) return
    if (delta < 0 && r.d <= 0) return
    setAdj(a => ({ ...a, [r.h.code]: (a[r.h.code] || 0) + delta }))
  }

  // Équilibrage automatique : redistribue les livreurs de chaque ville selon le pic de commandes de chaque hub
  const balance = () => {
    const next: Record<string, number> = {}
    for (const city of sim.pool.keys()) {
      const rows = sim.rows.filter(r => r.h.city === city); const total = sim.pool.get(city)!.base
      const d = new Map(rows.map(r => [r.h.code, 0]))
      for (let i = 0; i < total; i++) {
        let best = rows[0], bestScore = -1
        for (const r of rows) { const score = r.peak / (((d.get(r.h.code) ?? 0) + 0.0001) * perDriver); if (score > bestScore) { bestScore = score; best = r } }
        d.set(best.h.code, (d.get(best.h.code) ?? 0) + 1)
      }
      for (const r of rows) next[r.h.code] = (d.get(r.h.code) ?? 0) - r.h.drivers
    }
    setAdj(next)
  }

  // Applique la simulation : déplace réellement des livreurs (les moins chargés) d'un hub à l'autre
  const apply = async () => {
    const moves: { code: string; to: string }[] = []
    try {
      setBusy(true); setMsg(null)
      const r = await fetch(`/api/ops/live${city ? `?city=${city}` : ''}`); if (!r.ok) throw new Error('Livreurs indisponibles')
      const live: LiveResult = await r.json()
      for (const c of sim.pool.keys()) {
        const rows = sim.rows.filter(x => x.h.city === c)
        const receivers = rows.filter(x => (adj[x.h.code] || 0) > 0).flatMap(x => Array(adj[x.h.code]).fill(x.h.code) as string[])
        for (const donor of rows.filter(x => (adj[x.h.code] || 0) < 0)) {
          const pick = live.drivers.filter(d => d.hubCode === donor.h.code).sort((a, b) => a.active - b.active).slice(0, -(adj[donor.h.code] || 0))
          for (const p of pick) { const to = receivers.shift(); if (to) moves.push({ code: p.code, to }) }
        }
      }
      if (!moves.length) { setMsg({ ok: false, s: 'Aucun déplacement à appliquer' }); return }
      if (!window.confirm(`Déplacer ${moves.length} livreur(s) vers un autre hub ?\n${moves.map(m => `${m.code} → ${m.to}`).join('\n')}`)) return
      let ok = 0
      for (const m of moves) { const res = await fetch(`/api/ops/drivers/${m.code}/hub`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hubCode: m.to }) }); if (res.ok) ok++ }
      setMsg({ ok: ok === moves.length, s: `${ok}/${moves.length} livreur(s) déplacé(s)` }); setAdj({}); onApplied()
    } catch (e) { setMsg({ ok: false, s: e instanceof Error ? e.message : 'Erreur' }) } finally { setBusy(false) }
  }

  // Recommandations : qui déplacer de où à où (par ville)
  const tips = useMemo(() => {
    const out: string[] = []
    for (const c of sim.pool.keys()) {
      const rows = sim.rows.filter(r => r.h.city === c)
      const short = rows.filter(r => r.gap > 0).sort((a, b) => b.gap - a.gap), spare = rows.filter(r => r.surplus > 0).sort((a, b) => b.surplus - a.surplus)
      for (const s of short) { const from = spare.find(x => x.surplus > 0); if (from) { const n = Math.min(s.gap, from.surplus); from.surplus -= n; out.push(`${c} : déplacer ${n} livreur(s) de ${from.h.name.replace('Marjane ', '')} vers ${s.h.name.replace('Marjane ', '')}`) } else out.push(`${c} : ${s.h.name.replace('Marjane ', '')} manque de ${s.gap} livreur(s) — renfort externe nécessaire`) }
    }
    return out
  }, [sim])

  const slots = forecast.slots
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <K label="Commandes prévues" v={forecast.summary.expected} sub={`${forecast.summary.known} déjà reçues`} />
        <K label="Créneaux saturés" v={sim.sat} tone={sim.sat ? 'red' : 'green'} sub={`${sim.tense} sous tension`} />
        <K label="Livreurs affectés" v={sim.rows.reduce((a, r) => a + r.d, 0)} sub={changed ? `base ${forecast.summary.drivers}` : 'capacité live'} />
        <K label="Livreurs manquants (pic)" v={sim.gap} tone={sim.gap ? 'red' : 'green'} sub="par hub, au pire créneau" />
        <K label="Livreurs en surplus" v={sim.surplus} tone={sim.surplus ? 'amber' : 'green'} sub="mobilisables ailleurs" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={balance} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-purple-300 text-purple-700 bg-white hover:bg-purple-50"><Scale className="w-4 h-4" />Équilibrer automatiquement</button>
        <button disabled={!changed} onClick={() => setAdj({})} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white disabled:opacity-40"><RotateCcw className="w-3.5 h-3.5" />Réinitialiser</button>
        <button disabled={!changed || busy} onClick={apply} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-purple-600 text-white disabled:opacity-40"><Truck className="w-4 h-4" />Appliquer (déplacer les livreurs)</button>
        <span className="text-xs text-gray-400">+ / − : simulation limitée aux livreurs disponibles dans la ville. {changed ? 'Simulation en cours — rien n’est déplacé tant que vous n’appliquez pas.' : ''}</span>
      </div>
      {msg && <div className={`text-sm rounded-lg p-2.5 border ${msg.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.s}</div>}

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-200">
              <th className="text-left p-3 font-medium">Hub</th><th className="p-2 font-medium">Livreurs (+/−)</th>
              {slots.map(s => <th key={s} className="p-2 font-medium whitespace-nowrap">{s.replace('-', 'h–')}h</th>)}
              <th className="p-2 font-medium">Total</th><th className="p-2 font-medium">Besoin</th>
            </tr>
          </thead>
          <tbody>
            {sim.rows.map(r => {
              const delta = adj[r.h.code] || 0
              return (
                <tr key={r.h.code} className="border-b border-gray-100">
                  <td className="p-3"><div className="font-medium text-gray-900">{r.h.name}</div><div className="text-xs text-gray-400">{r.h.city}</div></td>
                  <td className="p-2">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => bump(r, -1)} disabled={r.d <= 0} className="w-6 h-6 rounded-md border border-gray-300 flex items-center justify-center hover:bg-gray-50 disabled:opacity-30"><Minus className="w-3 h-3" /></button>
                      <span className="w-7 text-center font-semibold text-gray-800">{r.d}</span>
                      <button onClick={() => bump(r, 1)} disabled={free(r.h.city) <= 0} title={free(r.h.city) <= 0 ? 'Plus aucun livreur disponible dans cette ville — retirez-en d’abord à un autre hub' : 'Ajouter un livreur'} className="w-6 h-6 rounded-md border border-gray-300 flex items-center justify-center hover:bg-gray-50 disabled:opacity-30"><Plus className="w-3 h-3" /></button>
                    </div>
                    {delta !== 0 && <div className={`text-[10px] text-center mt-0.5 ${delta > 0 ? 'text-green-700' : 'text-red-600'}`}>{delta > 0 ? '+' : ''}{delta} (base {r.h.drivers})</div>}
                  </td>
                  {slots.map(s => {
                    const c = r.cells[s]
                    return (
                      <td key={s} className="p-1">
                        <div className={`rounded-md py-1.5 px-1 text-center ${LEVEL_STYLE[c.level]}`} title={`Prévu ${c.expected} · reçu ${c.known} · capacité ${c.capacity} · charge ${Math.round(c.load * 100)}% · besoin ${c.needed} livreur(s)`}>
                          <div className="text-base leading-none">{c.expected || '·'}</div>
                          {c.expected > 0 && (
                            <>
                              <div className="h-1 rounded-full bg-black/10 mt-1 mx-1 overflow-hidden"><div className={`h-full ${BAR[c.level]}`} style={{ width: `${c.capacity === 0 ? 100 : Math.min(100, c.load * 100)}%` }} /></div>
                              <div className="text-[10px] opacity-70 mt-0.5">{c.capacity === 0 ? 'sans livreur' : `${Math.round(c.load * 100)}%`} · {c.known} reçues</div>
                              {c.needed > r.d && <div className="text-[10px] font-semibold text-red-700">+{c.needed - r.d} livreur(s)</div>}
                            </>
                          )}
                        </div>
                      </td>
                    )
                  })}
                  <td className="text-center font-semibold text-gray-900 p-2">{r.h.totalExpected}<div className="text-[10px] font-normal text-gray-400">{r.h.totalKnown} reçues</div></td>
                  <td className="text-center p-2 whitespace-nowrap">
                    <div className="text-xs text-gray-500">{r.need} requis</div>
                    {r.gap > 0 ? <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">manque {r.gap}</span> : r.surplus > 0 ? <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">surplus {r.surplus}</span> : <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">ajusté</span>}
                  </td>
                </tr>
              )
            })}
            <tr className="bg-gray-50 text-gray-700 font-semibold">
              <td className="p-3">Total</td><td className="text-center">{sim.rows.reduce((a, r) => a + r.d, 0)}</td>
              {slots.map(s => { const t = sim.totals[s]; const l = t.capacity ? t.expected / t.capacity : 0; return <td key={s} className="text-center p-2">{t.expected}<div className={`text-[10px] font-normal ${l >= 1 ? 'text-red-600' : 'text-gray-400'}`}>/{t.capacity} · {Math.round(l * 100)}%</div></td> })}
              <td className="text-center">{forecast.summary.expected}</td><td />
            </tr>
          </tbody>
        </table>
      </div>

      {tips.length > 0 && (
        <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
          <div className="text-sm font-medium text-purple-900 mb-1">Recommandations</div>
          <ul className="space-y-0.5 text-sm text-purple-900">{tips.map((t, i) => <li key={i} className="flex items-center gap-1.5"><ArrowRight className="w-3.5 h-3.5 shrink-0" />{t}</li>)}</ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        {(['ok', 'tendu', 'sature'] as Level[]).map(l => <span key={l} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded ${LEVEL_STYLE[l].split(' ')[0]} border border-gray-200`} />{l === 'ok' ? `< ${Math.round((forecast.thresholds?.tense ?? 0.7) * 100)} % de la capacité` : l === 'tendu' ? `${Math.round((forecast.thresholds?.tense ?? 0.7) * 100)}–${Math.round((forecast.thresholds?.saturated ?? 1) * 100)} %` : `≥ ${Math.round((forecast.thresholds?.saturated ?? 1) * 100)} % (saturé)`}</span>)}
        <span>Prévu = f(reçu à ce jour, historique, courbe d&apos;arrivée) · capacité = livreurs × {perDriver} commandes / créneau</span>
      </div>
    </div>
  )
}

function K({ label, v, sub, tone = 'default' }: { label: string; v: number; sub?: string; tone?: 'default' | 'red' | 'amber' | 'green' }) {
  const c = { default: 'text-gray-900', red: 'text-red-600', amber: 'text-amber-600', green: 'text-green-600' }[tone]
  return <div className="bg-white border border-gray-200 rounded-xl p-4"><div className="text-xs text-gray-500">{label}</div><div className={`text-2xl font-bold mt-1 ${c}`}>{v}</div>{sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}</div>
}
