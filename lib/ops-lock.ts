/**
 * lib/ops-lock.ts — verrou de période (Sprint 18) : une fois la paie d'un mois VALIDÉE (OpsPayRun.status validated | paid),
 * son pointage ne peut plus être modifié (sauf par un ADMIN qui doit rouvrir la clôture, journalisé).
 */
import { prisma } from '@/lib/prisma'

export const monthOf = (day: string) => day.slice(0, 7)

/** Statut de clôture du mois contenant ce jour ('draft' | 'validated' | 'paid' | null si aucune clôture). */
export async function periodStatus(day: string): Promise<'draft' | 'validated' | 'paid' | null> {
  const r = await prisma.opsPayRun.findUnique({ where: { period: monthOf(day) }, select: { status: true } })
  return (r?.status as 'draft' | 'validated' | 'paid' | undefined) ?? null
}

/** Vrai si le mois de ce jour est verrouillé (paie validée ou payée). */
export async function isDayLocked(day: string): Promise<boolean> {
  const s = await periodStatus(day)
  return s === 'validated' || s === 'paid'
}

export const LOCKED_MESSAGE = 'Période clôturée : la paie de ce mois est validée. Un administrateur doit rouvrir la clôture avant toute modification.'
