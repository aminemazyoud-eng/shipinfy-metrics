/**
 * lib/ops-attendance.ts — le pointage a UNE seule source : RH & Formation (table DriverAttendance, page /pointage).
 * Le cockpit Opérations (dispatch, paie, bonus) lit et écrit cette même table — aucun doublon.
 * Clé : driverName = « Prénom Nom » du livreur Ops ; jour = minuit UTC du jour local.
 */
import { prisma } from '@/lib/prisma'
import { attendanceKey } from '@/lib/ops-time'

export const fullName = (d: { firstName: string; lastName: string }) => `${d.firstName} ${d.lastName}`

export interface Att { status: string; checkIn: Date | null; checkOut: Date | null; notes: string | null; hub: string | null }

/** Pointage d'un jour, indexé par nom de livreur. */
export async function attendanceByName(day: string): Promise<Map<string, Att>> {
  const rows = await prisma.driverAttendance.findMany({ where: { date: attendanceKey(day) } })
  return new Map(rows.map(r => [r.driverName, { status: r.status, checkIn: r.checkIn, checkOut: r.checkOut, notes: r.notes, hub: r.hub }]))
}

export interface AttPatch { status?: string; checkIn?: Date | null; checkOut?: Date | null; notes?: string | null; hub?: string | null }

export async function setAttendance(driver: { firstName: string; lastName: string }, hubName: string | null, day: string, patch: AttPatch, defaults: { status: string; checkIn?: Date | null } = { status: 'present' }) {
  const driverName = fullName(driver); const date = attendanceKey(day)
  return prisma.driverAttendance.upsert({
    where: { driverName_date: { driverName, date } },
    update: { ...(patch.status ? { status: patch.status } : {}), ...(patch.checkIn !== undefined ? { checkIn: patch.checkIn } : {}), ...(patch.checkOut !== undefined ? { checkOut: patch.checkOut } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.hub !== undefined ? { hub: patch.hub } : {}) },
    create: { driverName, date, hub: patch.hub ?? hubName, status: patch.status ?? defaults.status, role: 'LIVREUR', checkIn: patch.checkIn !== undefined ? patch.checkIn : defaults.checkIn ?? null, checkOut: patch.checkOut ?? null, notes: patch.notes ?? null },
  })
}
