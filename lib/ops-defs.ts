/**
 * lib/ops-defs.ts — UNE seule définition de chaque notion métier (Sprint 17 B7).
 * Avant : « retard » avait 5 définitions (Cockpit, Suivi, alertes, KPI, Dispatch) → totaux différents selon l'écran.
 * Règles retenues (à confirmer — question 2 de l'audit) :
 *   - terminé  = DELIVERED | NO_SHOW | CANCELLED ; une commande ANNULÉE n'est jamais en retard et ne compte pas dans la capacité ;
 *   - retard   = non terminée ET créneau (slotEnd) dépassé — les commandes non assignées (READY_PICKUP) comptent, avec un sous-total ;
 *   - à risque = non terminée, pas encore en livraison, fin de créneau dans moins de CFG.atRiskMinutes ;
 *   - à l'heure = livrée au plus tard à slotEnd (sans tolérance) ; non assignée = READY_PICKUP sans livreur.
 * Fonctions pures — importer ces fonctions plutôt que re-coder le test.
 */
import { CFG } from '@/lib/ops-config'

export const TERMINAL_STATUSES = ['DELIVERED', 'NO_SHOW', 'CANCELLED'] as const
export const DONE_STATUSES = ['DELIVERED', 'NO_SHOW'] as const // terminées « réellement » (hors annulation)

type When = string | number | Date | null | undefined
export interface OrderState { status: string; slotEnd: When; driverId?: string | null; deliveredAt?: When }

const ms = (v: When): number => (v == null ? NaN : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v))

export const isTerminal = (status: string) => (TERMINAL_STATUSES as readonly string[]).includes(status)
export const isCancelled = (status: string) => status === 'CANCELLED'
export const isOpen = (o: { status: string }) => !isTerminal(o.status)
export const isUnassigned = (o: { status: string; driverId?: string | null }) => o.status === 'READY_PICKUP' && !o.driverId

export const isLate = (o: OrderState, nowMs: number) => isOpen(o) && nowMs > ms(o.slotEnd)
export const isAtRisk = (o: OrderState, nowMs: number, atRiskMinutes = CFG.atRiskMinutes) =>
  isOpen(o) && o.status !== 'START_DELIVERY' && nowMs <= ms(o.slotEnd) && ms(o.slotEnd) - nowMs < atRiskMinutes * 60_000
export const isOnTime = (o: OrderState) => o.status === 'DELIVERED' && ms(o.deliveredAt) <= ms(o.slotEnd)
export const isDeliveredLate = (o: OrderState) => o.status === 'DELIVERED' && ms(o.deliveredAt) > ms(o.slotEnd)

/** Minutes de retard d'une commande ouverte (0 si pas en retard). */
export const lateMinutes = (o: OrderState, nowMs: number) => (isLate(o, nowMs) ? Math.round((nowMs - ms(o.slotEnd)) / 60_000) : 0)

/** Filtre Prisma équivalent à isOpen (pour les `where`). */
export const OPEN_WHERE = { status: { notIn: [...TERMINAL_STATUSES] as string[] } }
