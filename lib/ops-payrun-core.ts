/**
 * lib/ops-payrun-core.ts — logique PURE de la clôture mensuelle de la paie (aucun accès base, testable sous Node).
 * Cycle de vie : draft -> validated -> paid ; réouverture validated -> draft (ADMIN, motif obligatoire).
 * Un mois validé/payé est figé : jamais recalculé, tarifs et jours inclus.
 */
export type RunStatus = 'draft' | 'validated' | 'paid'
export type RunAction = 'draft' | 'validate' | 'paid' | 'reopen' | 'adjust'

export const MAX_ADJUSTMENT = 5000 // MAD, borne ± par ligne
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export const isPeriod = (p: unknown): p is string => typeof p === 'string' && PERIOD_RE.test(p)

/** Premier et dernier jour (YYYY-MM-DD) d'un mois 'YYYY-MM'. */
export function periodRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` }
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Montant final d'une ligne = net calculé + ajustement manuel. */
export const finalOf = (net: number, adjustment: number): number => r2(net + adjustment)

export interface RunLineAmounts { gross: number; bonus: number; deductions: number; net: number; adjustment: number; final: number; delivered?: number }
export interface RunTotals { gross: number; bonus: number; deductions: number; net: number; adjustments: number; final: number; delivered: number; people: number }

/** Totaux d'une clôture (net = Σ net calculé ; final = Σ net + ajustements, c'est le montant réellement payé). */
export function totalsOf(lines: RunLineAmounts[]): RunTotals {
  const s = (f: (l: RunLineAmounts) => number) => r2(lines.reduce((a, l) => a + f(l), 0))
  return { gross: s(l => l.gross), bonus: s(l => l.bonus), deductions: s(l => l.deductions), net: s(l => l.net), adjustments: s(l => l.adjustment), final: s(l => l.final), delivered: lines.reduce((a, l) => a + (l.delivered ?? 0), 0), people: lines.length }
}

/** Transitions autorisées. Retourne le statut cible ou une erreur claire. */
export function nextStatus(current: RunStatus | null, action: RunAction): { ok: true; to: RunStatus } | { ok: false; error: string } {
  switch (action) {
    case 'draft':
      if (current === 'validated' || current === 'paid') return { ok: false, error: 'Mois déjà validé : impossible de recalculer. Un administrateur doit d’abord rouvrir la clôture.' }
      return { ok: true, to: 'draft' }
    case 'adjust':
      if (current !== 'draft') return { ok: false, error: current ? 'Ajustement impossible : la clôture n’est plus en brouillon.' : 'Aucun brouillon pour ce mois : calculez-le d’abord.' }
      return { ok: true, to: 'draft' }
    case 'validate':
      if (current !== 'draft') return { ok: false, error: current ? 'Seul un brouillon peut être validé.' : 'Aucun brouillon à valider.' }
      return { ok: true, to: 'validated' }
    case 'paid':
      if (current !== 'validated') return { ok: false, error: 'Seule une clôture validée peut être marquée payée.' }
      return { ok: true, to: 'paid' }
    case 'reopen':
      if (current === 'paid') return { ok: false, error: 'Une clôture déjà payée ne peut pas être rouverte.' }
      if (current !== 'validated') return { ok: false, error: 'Seule une clôture validée peut être rouverte.' }
      return { ok: true, to: 'draft' }
  }
}

/** Validation d'un ajustement manuel : montant fini, borné ±5000 MAD, note obligatoire si ≠ 0. */
export function checkAdjustment(amount: unknown, note: unknown): { ok: true; amount: number; note: string | null } | { ok: false; error: string } {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return { ok: false, error: 'Montant d’ajustement invalide.' }
  const a = r2(amount)
  if (Math.abs(a) > MAX_ADJUSTMENT) return { ok: false, error: `Ajustement limité à ±${MAX_ADJUSTMENT} MAD par ligne.` }
  const n = typeof note === 'string' ? note.trim().slice(0, 300) : ''
  if (a !== 0 && !n) return { ok: false, error: 'Une note est obligatoire pour tout ajustement non nul.' }
  return { ok: true, amount: a, note: a === 0 ? null : n }
}

/** Ajoute l'ajustement à une ligne (refusé hors brouillon). */
export function applyAdjustment<T extends { net: number }>(status: RunStatus | null, line: T, amount: unknown, note: unknown):
  { ok: true; line: T & { adjustment: number; adjustmentNote: string | null; final: number } } | { ok: false; error: string } {
  const t = nextStatus(status, 'adjust'); if (!t.ok) return t
  const c = checkAdjustment(amount, note); if (!c.ok) return c
  return { ok: true, line: { ...line, adjustment: c.amount, adjustmentNote: c.note, final: finalOf(line.net, c.amount) } }
}
