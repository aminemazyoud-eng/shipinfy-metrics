/**
 * lib/ops-gamification.ts — classement par hub, badges, séries (Sprint 21). Fonctions pures.
 * Score = livraisons à l'heure (1 pt) ; les retards ne retirent rien (motivation positive). Seuil de classement : >= minOrders livraisons.
 */
export interface DayResult { driverId: string; hub: string; day: string; delivered: number; onTime: number }
export interface Standing { driverId: string; hub: string; delivered: number; onTime: number; rate: number; rank: number; badges: string[]; streak: number }

/** Série = nombre de jours consécutifs (jusqu'au dernier jour fourni) avec >= 1 livraison et 100 % à l'heure. */
export function onTimeStreak(days: DayResult[]): number {
  const sorted = [...days].sort((a, b) => b.day.localeCompare(a.day))
  let s = 0
  for (const d of sorted) { if (d.delivered > 0 && d.onTime === d.delivered) s++; else break }
  return s
}

export function badgesFor(total: { delivered: number; onTime: number }, streak: number): string[] {
  const b: string[] = []
  if (total.delivered >= 100) b.push('centurion')
  if (total.delivered >= 20 && total.onTime === total.delivered) b.push('sans-faute')
  if (streak >= 3) b.push('série-3')
  if (streak >= 7) b.push('série-7')
  return b
}

export function leaderboard(results: DayResult[], minOrders = 5): Record<string, Standing[]> {
  const per = new Map<string, DayResult[]>()
  for (const r of results) (per.get(r.driverId) ?? per.set(r.driverId, []).get(r.driverId)!).push(r)
  const rows: Standing[] = []
  for (const [driverId, days] of per) {
    const delivered = days.reduce((s, d) => s + d.delivered, 0), onTime = days.reduce((s, d) => s + d.onTime, 0)
    if (delivered < minOrders) continue
    const streak = onTimeStreak(days)
    rows.push({ driverId, hub: days[days.length - 1].hub, delivered, onTime, rate: Math.round((onTime / delivered) * 1000) / 10, rank: 0, badges: badgesFor({ delivered, onTime }, streak), streak })
  }
  const out: Record<string, Standing[]> = {}
  for (const r of rows) (out[r.hub] ??= []).push(r)
  for (const hub of Object.keys(out)) {
    out[hub].sort((a, b) => b.onTime - a.onTime || b.rate - a.rate || a.driverId.localeCompare(b.driverId))
    out[hub].forEach((r, i) => { r.rank = i + 1 })
  }
  return out
}
