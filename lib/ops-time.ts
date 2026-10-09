// Helpers de date côté serveur pour les routes /api/ops/* — fuseau Africa/Casablanca RÉEL (Sprint 17 B6).
// Fines enveloppes de lib/tz.ts (mêmes signatures qu'avant, pour ne casser aucun appelant) : plus de décalage fixe +1 h,
// le Ramadan (UTC+0) est géré par la base IANA via Intl.
import { localToday as tzToday, dayOfTz, dayBoundsTz, attendanceKeyTz } from '@/lib/tz'

export const localToday = (nowMs = Date.now()): string => tzToday(nowMs)

/** 'today' | 'tomorrow' | 'yesterday' | 'YYYY-MM-DD' | ±N  → 'YYYY-MM-DD' (jour local) */
export function dayOf(spec: string | null | undefined, nowMs = Date.now()): string {
  return dayOfTz(spec, nowMs)
}

/** Bornes UTC [début, fin[ d'une journée locale (23 h / 24 h / 25 h selon les bascules). */
export function dayBounds(day: string): { from: Date; to: Date } {
  return dayBoundsTz(day)
}

/** Clé de pointage : minuit UTC du jour local (une ligne par livreur et par jour). */
export const attendanceKey = (day: string): Date => attendanceKeyTz(day)
