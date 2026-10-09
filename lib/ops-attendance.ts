/**
 * lib/ops-attendance.ts — le pointage a UNE seule source : RH & Formation (table DriverAttendance, page /pointage).
 * Le cockpit Opérations (dispatch, paie, bonus) lit et écrit cette même table — aucun doublon.
 * Clé : driverName = « Prénom Nom » du livreur Ops ; jour = minuit UTC du jour local.
 * Sprint 18 : heures travaillées / retard calculés côté serveur, verrou de période et corrections tracées.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { attendanceKey } from '@/lib/ops-time'
import { roleAtLeast, type SessionPayload } from '@/lib/auth'
import { isDayLocked, LOCKED_MESSAGE } from '@/lib/ops-lock'
import { workedMinutes, lateMinutes, autoStatus } from '@/lib/ops-attendance-calc'

export const fullName = (d: { firstName: string; lastName: string }) => `${d.firstName} ${d.lastName}`

export interface Att { status: string; checkIn: Date | null; checkOut: Date | null; notes: string | null; hub: string | null; workedMinutes: number | null; lateMinutes: number | null; plannedDepart: string | null }

/** Pointage d'un jour, indexé par nom de livreur. */
export async function attendanceByName(day: string): Promise<Map<string, Att>> {
  const rows = await prisma.driverAttendance.findMany({ where: { date: attendanceKey(day) } })
  return new Map(rows.map(r => [r.driverName, { status: r.status, checkIn: r.checkIn, checkOut: r.checkOut, notes: r.notes, hub: r.hub, workedMinutes: r.workedMinutes, lateMinutes: r.lateMinutes, plannedDepart: r.plannedDepart }]))
}

/** Départ prévu « HH:MM » du planning du jour pour ce livreur (retrouvé par nom) ; null si inconnu ou non planifié. */
export async function plannedDepartFor(driverName: string, day: string): Promise<string | null> {
  try {
    const drivers = await prisma.opsDriver.findMany({ select: { code: true, firstName: true, lastName: true } })
    const key = driverName.trim().toLowerCase()
    const d = drivers.find(x => fullName(x).toLowerCase() === key)
    if (!d) return null
    const line = await prisma.opsPlanLine.findUnique({ where: { day_driverCode: { day, driverCode: d.code } }, select: { departTime: true } })
    return line?.departTime ?? null
  } catch { return null }
}

export interface DerivedFields { status: string; workedMinutes: number; lateMinutes: number; plannedDepart: string | null }

/**
 * Calcule heures / retard / statut d'un pointage. `explicitStatus` : statut choisi à la main (respecté tel quel) ;
 * sinon le statut est proposé automatiquement (present / late) sans jamais écraser absent / leave.
 */
export async function deriveFields(driverName: string, day: string, rec: { checkIn: Date | null; checkOut: Date | null; status?: string | null }, explicitStatus = false): Promise<DerivedFields> {
  const plannedDepart = await plannedDepartFor(driverName, day)
  const late = lateMinutes(rec.checkIn, plannedDepart, day)
  const status = explicitStatus && rec.status
    ? rec.status
    : autoStatus({ current: rec.status, hasCheckIn: !!rec.checkIn, hasPlan: !!plannedDepart, lateMinutes: late })
  return { status, workedMinutes: workedMinutes(rec.checkIn, rec.checkOut), lateMinutes: late, plannedDepart }
}

// ─── Corrections tracées + verrou de période ────────────────────────────────────

export const MIN_REASON = 3
export const reasonOk = (r: unknown): r is string => typeof r === 'string' && r.trim().length >= MIN_REASON

/** Instantané d'un pointage pour le journal (avant / après). */
export function snapshot(r: { status: string; checkIn: Date | null; checkOut: Date | null; notes: string | null; hub?: string | null } | null | undefined) {
  if (!r) return null
  return { status: r.status, checkIn: r.checkIn ? r.checkIn.toISOString() : null, checkOut: r.checkOut ? r.checkOut.toISOString() : null, notes: r.notes ?? null, hub: r.hub ?? null }
}

type Snap = { status: string; checkIn: Date | null; checkOut: Date | null; notes: string | null; hub: string | null }
export interface CorrPatch { status?: string; checkIn?: Date | null; checkOut?: Date | null; notes?: string | null; hub?: string | null }

/**
 * Vrai si le changement CORRIGE une valeur déjà saisie (donc motif obligatoire).
 * Compléter un champ vide (1re arrivée, 1er départ) n'est pas une correction.
 */
export function isCorrection(before: Snap | null, patch: CorrPatch): boolean {
  if (!before) return false
  const t = (d: Date | null | undefined) => (d ? d.getTime() : null)
  if (patch.status !== undefined && patch.status !== before.status) return true
  if (patch.checkIn !== undefined && before.checkIn && t(patch.checkIn) !== t(before.checkIn)) return true
  if (patch.checkOut !== undefined && before.checkOut && t(patch.checkOut) !== t(before.checkOut)) return true
  if (patch.notes !== undefined && before.notes && (patch.notes ?? null) !== before.notes) return true
  if (patch.hub !== undefined && before.hub && (patch.hub ?? null) !== before.hub) return true
  return false
}

export interface GuardResult { error?: NextResponse; reason: string | null; overridden: boolean }

/**
 * Garde commune POST / PATCH / DELETE : (a) période verrouillée → 423 (sauf ADMIN+ avec override + motif),
 * (c) motif (≥ 3 caractères) obligatoire quand `needsReason`. `day` = jour local YYYY-MM-DD.
 */
export async function guardCorrection(session: SessionPayload, day: string, opts: { needsReason: boolean; reason?: unknown; override?: unknown }): Promise<GuardResult> {
  const reason = typeof opts.reason === 'string' ? opts.reason.trim() : ''
  let overridden = false
  if (await isDayLocked(day)) {
    if (opts.override === true && roleAtLeast(session.role, 'ADMIN')) {
      if (!reasonOk(reason)) return { error: NextResponse.json({ error: `Motif obligatoire (${MIN_REASON} caractères minimum) pour modifier une période clôturée`, code: 'REASON_REQUIRED' }, { status: 400 }), reason: null, overridden: false }
      overridden = true
    } else {
      return { error: NextResponse.json({ error: LOCKED_MESSAGE, code: 'PERIOD_LOCKED', locked: true }, { status: 423 }), reason: null, overridden: false }
    }
  }
  if (opts.needsReason && !reasonOk(reason)) {
    return { error: NextResponse.json({ error: `Motif obligatoire (${MIN_REASON} caractères minimum) pour modifier ou supprimer un pointage existant`, code: 'REASON_REQUIRED' }, { status: 400 }), reason: null, overridden: false }
  }
  return { reason: reason || null, overridden }
}

export interface AttPatch { status?: string; checkIn?: Date | null; checkOut?: Date | null; notes?: string | null; hub?: string | null }

/**
 * Crée / met à jour le pointage d'un livreur pour un jour, en recalculant heures, retard et statut.
 * Retourne aussi l'état AVANT (pour le journal). Le statut explicite du patch est respecté ; sinon proposition automatique.
 */
export async function setAttendance(driver: { firstName: string; lastName: string }, hubName: string | null, day: string, patch: AttPatch, defaults: { status: string; checkIn?: Date | null } = { status: 'present' }) {
  const driverName = fullName(driver); const date = attendanceKey(day)
  const existing = await prisma.driverAttendance.findUnique({ where: { driverName_date: { driverName, date } } })
  const checkIn = patch.checkIn !== undefined ? patch.checkIn : existing ? existing.checkIn : (defaults.checkIn ?? null)
  const checkOut = patch.checkOut !== undefined ? patch.checkOut : existing ? existing.checkOut : null
  const baseStatus = patch.status ?? existing?.status ?? defaults.status
  const d = await deriveFields(driverName, day, { checkIn, checkOut, status: baseStatus }, !!patch.status)
  const calc = { workedMinutes: d.workedMinutes, lateMinutes: d.lateMinutes, plannedDepart: d.plannedDepart }
  const rec = await prisma.driverAttendance.upsert({
    where: { driverName_date: { driverName, date } },
    update: { status: d.status, checkIn, checkOut, ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.hub !== undefined ? { hub: patch.hub } : {}), ...calc },
    create: { driverName, date, hub: patch.hub ?? hubName, status: d.status, role: 'LIVREUR', checkIn, checkOut, notes: patch.notes ?? null, ...calc },
  })
  return { rec, before: existing }
}
