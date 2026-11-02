/**
 * lib/ops-express.ts — règles Express 45 / 80 min (Sprint 21).
 * Fonctions pures. HYPOTHÈSES À VALIDER (questions 2-3 de l'audit) :
 *   - SLA 80 min pour les grosses commandes (>= largeItems articles), sinon 45 min ;
 *   - le chrono démarre à l'assignation (repli : création), s'arrête à la livraison ou à l'annulation, et retire les pauses ;
 *   - paliers d'alerte : SLA (niveau 1), SLA+5 (niveau 2), SLA+10 (niveau 3) → 45/50/55 ou 80/85/90.
 */
export interface ExpressParams { smallSla: number; largeSla: number; largeItems: number; step: number }
export const EXPRESS_DEFAULTS: ExpressParams = { smallSla: 45, largeSla: 80, largeItems: 15, step: 5 }

export const expressSla = (items: number | null | undefined, p: ExpressParams = EXPRESS_DEFAULTS): number =>
  (items ?? 0) >= p.largeItems ? p.largeSla : p.smallSla

export interface ExpressTimer { startedAt: number; endedAt?: number | null; cancelled?: boolean; pausedMinutes?: number }

/** Règle par type de magasin (donnée réelle des imports) : hypermarché → 80 min, sinon 45 ; repli sur le nombre d'articles. */
export const expressSlaForOrder = (o: { storeType?: string | null; items?: number | null }, p: ExpressParams = EXPRESS_DEFAULTS): number =>
  o.storeType === 'hypermarket' ? p.largeSla : o.storeType === 'supermarket' ? p.smallSla : expressSla(o.items, p)

/** Minutes écoulées effectives (pause retirée) ; null si annulée (hors SLA). */
export function expressElapsed(t: ExpressTimer, nowMs: number): number | null {
  if (t.cancelled) return null
  const end = t.endedAt ?? nowMs
  return Math.max(0, Math.round((end - t.startedAt) / 60_000 - (t.pausedMinutes ?? 0)))
}

/** 0 = dans le SLA, 1/2/3 = paliers de dépassement. */
export function expressLevel(elapsedMin: number, sla: number, p: ExpressParams = EXPRESS_DEFAULTS): 0 | 1 | 2 | 3 {
  if (elapsedMin >= sla + 2 * p.step) return 3
  if (elapsedMin >= sla + p.step) return 2
  if (elapsedMin >= sla) return 1
  return 0
}

export const expressRespected = (elapsedMin: number | null, sla: number) => elapsedMin != null && elapsedMin <= sla
