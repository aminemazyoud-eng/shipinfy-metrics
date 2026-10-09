/**
 * lib/tz.ts — fuseau Africa/Casablanca RÉEL (Sprint 17 B6).
 * Le Maroc est à UTC+1 toute l'année SAUF pendant le Ramadan (UTC+0, ≈30 jours/an) : un décalage fixe de +1 h est donc faux
 * pendant cette période. On s'appuie sur la base IANA via Intl (ICU complet disponible sur Node ≥ 13) — plus aucun TZ_MS fixe.
 * Fonctions pures, sans dépendance applicative.
 */
const TZ = 'Africa/Casablanca'
const DAY = 86_400_000
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export interface LocalParts { day: string; hour: number; minute: number; weekday: number }

/** Jour / heure locaux marocains d'un instant UTC. `weekday` : 0 = dimanche. */
export function localParts(ms: number): LocalParts {
  const p: Record<string, string> = {}
  for (const x of fmt.formatToParts(ms)) p[x.type] = x.value
  const day = `${p.year}-${p.month}-${p.day}`
  return { day, hour: Number(p.hour), minute: Number(p.minute), weekday: new Date(day + 'T12:00:00Z').getUTCDay() }
}

/** Décalage (ms) de l'heure locale par rapport à UTC à cet instant : +3 600 000 en temps normal, 0 pendant le Ramadan. */
export function offsetMs(ms: number): number {
  const l = localParts(ms)
  const asUtc = Date.parse(`${l.day}T${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}:00Z`)
  return asUtc - Math.floor(ms / 60_000) * 60_000
}

export const localDay = (ms: number): string => localParts(ms).day
export const localToday = (nowMs = Date.now()): string => localDay(nowMs)

/** Instant UTC du début (00:00 locale) d'un jour local « YYYY-MM-DD ». */
export function dayStartUtc(day: string): number {
  const guess = Date.parse(day + 'T00:00:00Z')
  let t = guess - offsetMs(guess)
  t = guess - offsetMs(t) // un second passage corrige les jours de bascule (Ramadan)
  return t
}

export const addDays = (day: string, n: number): string => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10)

/** Bornes UTC [début, fin[ d'un jour local (23 h / 24 h / 25 h selon les bascules). */
export function dayBoundsTz(day: string): { from: Date; to: Date } {
  return { from: new Date(dayStartUtc(day)), to: new Date(dayStartUtc(addDays(day, 1))) }
}

/** « today | tomorrow | yesterday | YYYY-MM-DD | ±N » → « YYYY-MM-DD » (jour local). */
export function dayOfTz(spec: string | null | undefined, nowMs = Date.now()): string {
  const today = localDay(nowMs)
  if (!spec || spec === 'today') return today
  if (spec === 'tomorrow') return addDays(today, 1)
  if (spec === 'yesterday') return addDays(today, -1)
  if (/^\d{4}-\d\d-\d\d$/.test(spec)) return spec
  return addDays(today, Number(spec) || 0)
}

/** Clé de pointage : minuit UTC du jour local (une ligne par livreur et par jour). */
export const attendanceKeyTz = (day: string): Date => new Date(day + 'T00:00:00Z')

/** Heure locale décimale (ex. 14,5 = 14 h 30) — pour rattacher une commande à un créneau. */
export function localHour(ms: number): number {
  const l = localParts(ms)
  return l.hour + l.minute / 60
}
