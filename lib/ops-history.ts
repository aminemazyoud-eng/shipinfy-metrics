/**
 * lib/ops-history.ts — agrégats d'historique pour le consulting (fonction pure).
 * Volumes, taux à l'heure, NO_SHOW par jour / hub / créneau / livreur, matrice jour de semaine × créneau
 * et courbe d'arrivée des commandes (part du volume final connue à H-24, H-12, H-6, H-3, H-0) —
 * c'est cette courbe qui permet d'anticiper le volume du lendemain.
 */
import { canonicalSlot, SLOT_LABELS } from '@/lib/ops-slots'

export interface HistRow { slotStart: Date; slotEnd: Date; status: string; hubCode: string | null; driverCode: string | null; createdAt: Date | null; deliveredAt: Date | null; noShowAt: Date | null; amount: number | null }

const TZ = 3_600_000
const HOUR = 3_600_000
const day = (d: Date) => new Date(d.getTime() + TZ).toISOString().slice(0, 10)
const wd = (d: Date) => new Date(d.getTime() + TZ).getUTCDay()
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)

interface Acc { total: number; delivered: number; onTime: number; noShow: number; amount: number }
const acc = (): Acc => ({ total: 0, delivered: 0, onTime: 0, noShow: 0, amount: 0 })
function add(a: Acc, r: HistRow) {
  a.total++; a.amount += r.amount ?? 0
  if (r.status === 'DELIVERED') { a.delivered++; if (r.deliveredAt && r.deliveredAt <= r.slotEnd) a.onTime++ }
  else if (r.status === 'NO_SHOW') a.noShow++
}
const fin = (k: string, a: Acc) => ({ key: k, total: a.total, delivered: a.delivered, noShow: a.noShow, onTimeRate: pct(a.onTime, a.delivered), noShowRate: pct(a.noShow, a.total), deliveryRate: pct(a.delivered, a.total), amount: Math.round(a.amount) })

export function buildHistory(rows: HistRow[]) {
  const byDay = new Map<string, Acc>(), byHub = new Map<string, Acc>(), bySlot = new Map<string, Acc>(), byDriver = new Map<string, Acc>(), all = acc()
  const matrix = new Map<string, { sum: number; days: Set<string> }>()
  for (const r of rows) {
    const d = day(r.slotStart), slot = canonicalSlot(r.slotStart)
    add(all, r)
    add(byDay.get(d) ?? byDay.set(d, acc()).get(d)!, r)
    add(byHub.get(r.hubCode ?? '—') ?? byHub.set(r.hubCode ?? '—', acc()).get(r.hubCode ?? '—')!, r)
    add(bySlot.get(slot) ?? bySlot.set(slot, acc()).get(slot)!, r)
    if (r.driverCode) add(byDriver.get(r.driverCode) ?? byDriver.set(r.driverCode, acc()).get(r.driverCode)!, r)
    const k = `${wd(r.slotStart)}|${slot}`; const m = matrix.get(k) ?? matrix.set(k, { sum: 0, days: new Set() }).get(k)!
    m.sum++; m.days.add(d)
  }
  // jours de la semaine : volume moyen par créneau (moyenne sur les jours observés de ce jour de semaine)
  const daysByWd = new Map<number, Set<string>>()
  for (const d of byDay.keys()) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); (daysByWd.get(w) ?? daysByWd.set(w, new Set()).get(w)!).add(d) }
  const weekdayMatrix = [1, 2, 3, 4, 5, 6, 0].map(w => ({ weekday: w, days: daysByWd.get(w)?.size ?? 0, slots: Object.fromEntries(SLOT_LABELS.map(s => { const m = matrix.get(`${w}|${s}`); const n = daysByWd.get(w)?.size ?? 0; return [s, n ? Math.round(((m?.sum ?? 0) / n) * 10) / 10 : 0] })) }))

  // courbe d'arrivée (global) : part des commandes connues N heures avant le début du créneau
  const withLead = rows.filter(r => r.createdAt)
  const arrivalCurve = [24, 12, 6, 3, 0].map(h => ({ hoursBefore: h, knownPct: withLead.length ? Math.round((withLead.filter(r => (r.slotStart.getTime() - (r.createdAt as Date).getTime()) >= h * HOUR).length / withLead.length) * 1000) / 10 : null }))

  const dayRows = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, a]) => fin(k, a))
  return {
    totals: { ...fin('all', all), days: dayRows.length, avgPerDay: dayRows.length ? Math.round((all.total / dayRows.length) * 10) / 10 : 0 },
    byDay: dayRows,
    byHub: [...byHub.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, a]) => fin(k, a)),
    bySlot: SLOT_LABELS.map(s => fin(s, bySlot.get(s) ?? acc())),
    byDriver: [...byDriver.entries()].sort((a, b) => b[1].delivered - a[1].delivered).map(([k, a]) => fin(k, a)),
    weekdayMatrix, arrivalCurve,
  }
}

export function historyCsv(h: ReturnType<typeof buildHistory>): string {
  const n = (v: number | null) => (v == null ? '' : String(v).replace('.', ','))
  const rows = [['Jour', 'Commandes', 'Livrées', 'NO_SHOW', '% à l\'heure', '% NO_SHOW', 'Montant COD'], ...h.byDay.map(d => [d.key, d.total, d.delivered, d.noShow, n(d.onTimeRate), n(d.noShowRate), d.amount])]
  return '﻿' + rows.map(r => r.map(c => `"${c}"`).join(';')).join('\r\n')
}
