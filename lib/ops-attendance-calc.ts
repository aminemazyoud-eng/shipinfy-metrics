/**
 * lib/ops-attendance-calc.ts — calculs purs du pointage (Sprint 18) : heures travaillées, retard, statut automatique.
 * Aucune dépendance applicative hors lib/tz.ts (fuseau Africa/Casablanca réel, Ramadan inclus).
 */
import { dayStartUtc } from '@/lib/tz'

/** Tolérance de retard (minutes) : au-delà, le statut proposé passe à « late ». */
export const LATE_GRACE_MIN = 10
/** Plafond d'une journée de travail (minutes) : une ligne oubliée ouverte ne gonfle pas les heures. */
export const MAX_WORK_MIN = 16 * 60

const ms = (d: Date | string | number | null | undefined): number | null => {
  if (d === null || d === undefined || d === '') return null
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
  return Number.isFinite(t) ? t : null
}

/** Minutes travaillées entre arrivée et départ (0 si l'un manque ou si départ <= arrivée), plafonné à 16 h. */
export function workedMinutes(checkIn: Date | string | null | undefined, checkOut: Date | string | null | undefined): number {
  const a = ms(checkIn), b = ms(checkOut)
  if (a === null || b === null) return 0
  const diff = Math.round((b - a) / 60_000)
  return diff > 0 ? Math.min(diff, MAX_WORK_MIN) : 0
}

/** « HH:MM » → minutes depuis minuit local (null si invalide). */
export function parseHm(hm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm ?? '').trim())
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2])
  return h > 23 || mi > 59 ? null : h * 60 + mi
}

/**
 * Retard brut en minutes par rapport au départ prévu « HH:MM » du jour local `day` (YYYY-MM-DD).
 * L'heure prévue est une heure LOCALE : on la convertit via le début de jour réel (Ramadan : UTC+0, sinon UTC+1).
 * 0 si à l'heure, en avance, sans arrivée ou sans départ prévu. La tolérance est appliquée par autoStatus, pas ici.
 */
export function lateMinutes(checkIn: Date | string | null | undefined, plannedDepart: string | null | undefined, day: string): number {
  const t = ms(checkIn), p = parseHm(plannedDepart)
  if (t === null || p === null) return 0
  const planned = dayStartUtc(day) + p * 60_000
  const diff = Math.floor((t - planned) / 60_000)
  return diff > 0 ? diff : 0
}

export interface AutoStatusInput {
  /** Statut actuellement saisi (peut être vide). */
  current?: string | null
  hasCheckIn: boolean
  /** Un départ prévu existe-t-il au planning ? Sinon on ne peut pas juger du retard : le statut courant est conservé. */
  hasPlan: boolean
  lateMinutes: number
}

/**
 * Statut proposé : 'late' si retard > tolérance, sinon 'present'.
 * Un statut saisi 'absent' ou 'leave' n'est JAMAIS écrasé.
 */
export function autoStatus(i: AutoStatusInput): string {
  const cur = i.current || ''
  if (cur === 'absent' || cur === 'leave') return cur
  if (!i.hasCheckIn || !i.hasPlan) return cur || 'present'
  return i.lateMinutes > LATE_GRACE_MIN ? 'late' : 'present'
}
