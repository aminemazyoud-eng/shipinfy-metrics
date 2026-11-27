/**
 * lib/bi-report.ts — rapports planifiés « Control Tower » : période relative + sections choisies (une section = un sous-module du Dashboard).
 * Fonctions pures (aucun accès base) : réutilisent EXACTEMENT les calculs du dashboard (lib/ops-bi.ts), donc mêmes chiffres qu'à l'écran.
 */
import { addDays, localToday } from '@/lib/tz'
import { BI_TABS, type BiTabKey } from '@/lib/bi-tabs'
import {
  DEFAULT_SEL, makeLocal, prepBi, n, overviewData, slotsData, leadData, driversData, geoData, clientsData, valueData, qualityData,
  type BiRaw, type Card, type Tbl, type Sel,
} from '@/lib/ops-bi'

export type ReportPeriod = 'yesterday' | 'last7' | 'lastMonth'
export const REPORT_PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: 'yesterday', label: 'Hier' },
  { key: 'last7', label: '7 derniers jours (jusqu’à hier)' },
  { key: 'lastMonth', label: 'Mois précédent' },
]
export const periodLabel = (p: string | null | undefined) => REPORT_PERIODS.find(x => x.key === p)?.label ?? 'Hier'
export const isReportPeriod = (p: unknown): p is ReportPeriod => REPORT_PERIODS.some(x => x.key === p)
export const isBiSection = (k: unknown): k is BiTabKey => BI_TABS.some(t => t.key === k)

/** Plage de jours LOCAUX [from, to] d'une période relative, calculée à partir de « maintenant ». */
export function periodRange(period: ReportPeriod, nowMs = Date.now()): { from: string; to: string } {
  const today = localToday(nowMs)
  if (period === 'last7') return { from: addDays(today, -7), to: addDays(today, -1) }
  if (period === 'lastMonth') {
    const to = addDays(today.slice(0, 8) + '01', -1)
    return { from: to.slice(0, 8) + '01', to }
  }
  const y = addDays(today, -1)
  return { from: y, to: y }
}

export interface ReportTable { title: string; tbl: Tbl }
export interface ReportSection { key: BiTabKey; title: string; cards: Card[]; tables: ReportTable[] }
export interface BiReport {
  from: string; to: string; hub: string | null; totalOrders: number; sections: ReportSection[]; generatedAt: string
}

const MAX_ROWS = 30
const cap = (t: Tbl): Tbl => (t.rows.length > MAX_ROWS ? { head: t.head, rows: [...t.rows.slice(0, MAX_ROWS - 1), t.rows.at(-1)!] } : t)

export function buildBiReport(
  raw: BiRaw[], sections: BiTabKey[], opts: { from: string; to: string; hub?: string | null; source?: { name: string; lastSync: string | null } },
): BiReport {
  const lp = makeLocal('1') // UTC+1, comme le dashboard par défaut
  const hub = opts.hub?.trim() || null
  const rows = raw.map(r => prepBi(r, lp)).filter(r => r.day >= opts.from && r.day <= opts.to && (!hub || r.hub === hub))
  const days = Math.round((Date.parse(opts.to) - Date.parse(opts.from)) / 86_400_000) + 1
  const sel: Sel = { ...DEFAULT_SEL, start: opts.from, end: opts.to, grain: days > 14 ? 'week' : 'day', volumeGrain: 'day', driverView: 'driver' }
  const want = new Set(sections)
  const out: ReportSection[] = []

  for (const t of BI_TABS) {
    if (!want.has(t.key) || !rows.length) continue
    const sec: ReportSection = { key: t.key, title: t.label, cards: [], tables: [] }
    switch (t.key) {
      case 'overview': {
        const d = overviewData(rows, sel, lp)
        sec.cards = d.metrics
        sec.tables = [
          { title: 'Statuts', tbl: { head: ['Statut', 'Commandes', 'Part'], rows: d.statusChips.map(c => [c.status, n(c.count), c.share]) } },
          { title: 'Évolution des commandes', tbl: cap({ head: ['Période', 'Commandes'], rows: d.volume.map(([k, v]) => [k, n(v)]) }) },
          { title: 'Répartition par magasin', tbl: { head: ['Magasin', 'Commandes'], rows: d.hubBars.map(([k, v]) => [k, n(v)]) } },
          { title: 'Activité par jour de semaine × magasin', tbl: cap(d.weekday.table) },
        ]
        break
      }
      case 'slots': {
        const d = slotsData(rows, sel)
        sec.cards = d.metrics
        sec.tables = [
          { title: 'Créneaux par magasin', tbl: cap(d.slotTable) }, { title: 'Paliers de retard', tbl: d.lateTable },
          { title: 'Statut × tentatives', tbl: cap(d.attemptTable) }, { title: 'Détails par magasin', tbl: cap(d.slotHubDetail) },
        ]
        break
      }
      case 'lead': {
        const d = leadData(rows, sel)
        sec.cards = d.metrics
        sec.tables = [
          { title: 'Délais par magasin', tbl: cap(d.leadTable) }, { title: 'Distribution des délais', tbl: d.leadDist },
          { title: 'Transmission vs créneau promis', tbl: d.anticipationTable }, { title: 'Lead Times × créneau', tbl: cap(d.leadSlots) },
        ]
        break
      }
      case 'drivers': {
        const d = driversData(rows, sel)
        sec.cards = d.metrics
        sec.tables = [
          { title: 'Productivité par livreur', tbl: cap({ head: d.head, rows: d.groups.map(g => [g.label, ...g.cells]) }) },
          { title: 'Performance détaillée (par magasin)', tbl: cap(d.detail) },
        ]
        break
      }
      case 'geo': {
        const d = geoData(rows, sel)
        sec.cards = d.metrics
        sec.tables = [{ title: 'Distance magasin → client', tbl: d.distanceTable }, { title: 'Distances par magasin', tbl: cap(d.distanceHub) }]
        break
      }
      case 'clients': {
        const d = clientsData(rows, sel)
        sec.cards = d.metrics
        sec.tables = [{ title: 'Fréquence de commande', tbl: d.clientTable }, { title: 'Récurrence × magasin', tbl: cap(d.clientCross) }]
        break
      }
      case 'value': {
        const d = valueData(rows, sel)
        sec.cards = d.metrics
        sec.tables = [{ title: 'Valeur par magasin', tbl: cap(d.hubTable) }, { title: 'Valeur par créneau', tbl: d.slotTable }]
        break
      }
      case 'quality': {
        const d = qualityData(rows, opts.source ?? { name: 'API', lastSync: null })
        sec.cards = d.metrics
        sec.tables = [{ title: 'Contrôles de cohérence', tbl: d.table }]
        break
      }
    }
    out.push(sec)
  }
  return { from: opts.from, to: opts.to, hub, totalOrders: rows.length, sections: out, generatedAt: new Date().toISOString() }
}

/** Corps texte de l'email : les cartes KPI de chaque section. */
export function biReportText(r: BiReport, label: string): string {
  const head = `${label}\nPériode : ${r.from === r.to ? r.from : `${r.from} au ${r.to}`} · Magasin : ${r.hub ?? 'tous'} · ${n(r.totalOrders)} commandes\n`
  const body = r.sections.map(s => `\n${s.title.toUpperCase()}\n` + s.cards.map(c => `- ${c.label} : ${c.value}${c.note ? ` (${c.note})` : ''}`).join('\n')).join('\n')
  return head + body + '\n\nLe détail (tableaux) est dans le PDF joint.\n— Shipinfy Metrics'
}

// ─────────────────────────── Validation d'une planification (partagée API / tests) ───────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface SchedulePayload {
  kind?: 'legacy' | 'bi'; reportId?: string; emails?: string[]; frequency?: string; time?: string
  name?: string; sections?: string[]; period?: string; hub?: string | null
}
export type ScheduleCheck =
  | { ok: true; value: { kind: 'legacy' | 'bi'; reportId: string; emails: string[]; name: string | null; sections: string | null; period: string | null; hub: string | null } }
  | { ok: false; error: string }

export function validateSchedulePayload(b: SchedulePayload): ScheduleCheck {
  const emails = (b.emails ?? []).map(e => String(e).trim()).filter(Boolean)
  if (!emails.length || !emails.every(e => EMAIL_RE.test(e))) return { ok: false, error: 'Adresses email invalides' }
  if (!['daily', 'weekly', 'monthly'].includes(b.frequency ?? '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time ?? '')) return { ok: false, error: 'Fréquence ou heure invalide' }
  if (b.kind !== 'bi') {
    if (!b.reportId) return { ok: false, error: 'reportId requis' }
    return { ok: true, value: { kind: 'legacy', reportId: b.reportId, emails, name: null, sections: null, period: null, hub: null } }
  }
  const sections = [...new Set((b.sections ?? []).filter(isBiSection))]
  if (!sections.length) return { ok: false, error: 'Choisissez au moins une section' }
  if (!isReportPeriod(b.period)) return { ok: false, error: 'Période invalide' }
  return { ok: true, value: { kind: 'bi', reportId: 'BI', emails, name: b.name?.trim().slice(0, 80) || null, sections: JSON.stringify(sections), period: b.period, hub: b.hub?.trim() || null } }
}
