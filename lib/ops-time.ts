// Helpers de date côté serveur pour les routes /api/ops/* (heure locale Maroc UTC+1).
const TZ_MS = 3_600_000
const DAY = 86_400_000

export const localToday = (nowMs = Date.now()) => new Date(nowMs + TZ_MS).toISOString().slice(0, 10)

/** 'today' | 'tomorrow' | 'yesterday' | 'YYYY-MM-DD' | ±N  → 'YYYY-MM-DD' */
export function dayOf(spec: string | null | undefined, nowMs = Date.now()): string {
  const base = Math.floor((nowMs + TZ_MS) / DAY)
  const idx = !spec || spec === 'today' ? base : spec === 'tomorrow' ? base + 1 : spec === 'yesterday' ? base - 1
    : /^\d{4}-\d\d-\d\d$/.test(spec) ? Math.floor(Date.parse(spec + 'T00:00:00Z') / DAY) : base + (Number(spec) || 0)
  return new Date(idx * DAY).toISOString().slice(0, 10)
}

/** Bornes UTC [début, fin[ d'une journée locale. */
export function dayBounds(day: string): { from: Date; to: Date } {
  const start = Date.parse(day + 'T00:00:00Z') - TZ_MS
  return { from: new Date(start), to: new Date(start + DAY) }
}

/** Clé de pointage : minuit UTC du jour local (une ligne par livreur et par jour). */
export const attendanceKey = (day: string) => new Date(day + 'T00:00:00Z')
