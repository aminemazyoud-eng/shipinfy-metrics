/**
 * lib/ops-special-days.ts — jours spéciaux (Ramadan, Aïd, fin de mois, promo…) : coefficient appliqué à la prévision (Sprint 17 C1).
 * lib/ops-analytics.ts n'est PAS modifié : on recalcule sur le résultat de forecastDay.
 *   expected' = round(expected × facteur) (jamais sous le « déjà reçu ») ; la capacité ne change pas ;
 *   charge, niveau, livreurs nécessaires, manque par hub, totaux par créneau et synthèse sont recalculés.
 * Un créneau déjà commencé au moment du calcul est figé (volume réel) : il n'est pas multiplié.
 */
import type { ForecastResult, Level } from '@/lib/ops-analytics'
import { dayStartUtc } from '@/lib/tz'

export const SPECIAL_KINDS = ['ramadan', 'aid', 'payday', 'promo', 'event'] as const
export const SPECIAL_FACTOR_MIN = 0.3
export const SPECIAL_FACTOR_MAX = 5
export interface SpecialDay { day: string; label: string; kind: string; factor: number }
export type ForecastWithSpecial = ForecastResult & { specialDay?: { label: string; factor: number } }

/** Facteurs des jours demandés (« YYYY-MM-DD »). Table absente ou base indisponible → aucun facteur (jamais d'erreur). */
export async function loadSpecialFactors(days: string[]): Promise<Map<string, { factor: number; label: string }>> {
  const out = new Map<string, { factor: number; label: string }>()
  if (!days.length) return out
  try {
    const { prisma } = await import('@/lib/prisma')
    const rows = await prisma.opsSpecialDay.findMany({ where: { day: { in: days } }, select: { day: true, label: true, factor: true } })
    for (const r of rows) if (Number.isFinite(r.factor) && r.factor > 0) out.set(r.day, { factor: Number(r.factor), label: r.label })
  } catch (e) { console.warn('[special-days]', e instanceof Error ? e.message : e) }
  return out
}

/** Applique le facteur du jour au résultat de forecastDay (copie : l'entrée n'est pas modifiée). */
export function applySpecialDays(forecast: ForecastResult, factors: Map<string, { factor: number; label: string }>): ForecastWithSpecial {
  const sp = factors.get(forecast.day)
  if (!sp || sp.factor === 1) return forecast
  const f = sp.factor, per = forecast.perDriverPerSlot || 1
  const { tense, saturated } = forecast.thresholds
  const nowMs = Date.parse(forecast.generatedAt)
  const dayStart = dayStartUtc(forecast.day)
  const started = (slot: string) => Number.isFinite(nowMs) && dayStart + Number(slot.slice(0, 2)) * 3_600_000 <= nowMs
  const levelOf = (load: number, expected: number): Level => (expected === 0 ? 'vide' : load >= saturated ? 'sature' : load >= tense ? 'tendu' : 'ok')

  const totals: ForecastResult['totals'] = {}
  for (const s of forecast.slots) totals[s] = { known: 0, expected: 0, capacity: 0 }
  let satCells = 0, tenseCells = 0, gapTotal = 0

  const hubs = forecast.hubs.map(h => {
    const cells: typeof h.cells = {}
    let te = 0, peak = 0, maxNeeded = 0
    for (const s of forecast.slots) {
      const c = h.cells[s]; if (!c) continue
      const expected = started(s) ? c.expected : Math.max(c.known, Math.round(c.expected * f))
      const load = c.capacity > 0 ? expected / c.capacity : expected > 0 ? 9.99 : 0
      const level = levelOf(load, expected), needed = Math.ceil(expected / per)
      cells[s] = { ...c, expected, load: Math.round(load * 100) / 100, level, neededDrivers: needed }
      te += expected; peak = Math.max(peak, load); maxNeeded = Math.max(maxNeeded, needed)
      totals[s].known += c.known; totals[s].expected += expected; totals[s].capacity += c.capacity
      if (level === 'sature') satCells++; else if (level === 'tendu') tenseCells++
    }
    const gap = Math.max(0, maxNeeded - h.drivers); gapTotal += gap
    return { ...h, cells, totalExpected: te, peakLoad: Math.round(peak * 100) / 100, gap }
  })

  return {
    ...forecast, hubs, totals,
    summary: { ...forecast.summary, expected: hubs.reduce((s, h) => s + h.totalExpected, 0), saturatedCells: satCells, tenseCells, driversGap: gapTotal },
    specialDay: { label: sp.label, factor: f },
  }
}

/** À appeler depuis la route /api/ops/forecast : charge le facteur du jour puis l'applique au résultat de forecastDay. */
export async function forecastWithSpecialDays(forecast: ForecastResult, day: string = forecast.day): Promise<ForecastWithSpecial> {
  return applySpecialDays(forecast, await loadSpecialFactors([day]))
}

/** Validation d'une entrée (POST) — renvoie un message d'erreur ou null. */
export function validateSpecialDay(b: Partial<SpecialDay>): string | null {
  if (!b.day || !/^\d{4}-\d\d-\d\d$/.test(b.day) || Number.isNaN(Date.parse(b.day + 'T12:00:00Z'))) return 'Date invalide (AAAA-MM-JJ)'
  if (!b.label || !String(b.label).trim() || String(b.label).length > 80) return 'Libellé requis (80 caractères max)'
  if (!(SPECIAL_KINDS as readonly string[]).includes(String(b.kind))) return `Type invalide (${SPECIAL_KINDS.join(' | ')})`
  const f = Number(b.factor)
  if (!Number.isFinite(f) || f < SPECIAL_FACTOR_MIN || f > SPECIAL_FACTOR_MAX) return `Facteur entre ${SPECIAL_FACTOR_MIN} et ${SPECIAL_FACTOR_MAX}`
  return null
}
