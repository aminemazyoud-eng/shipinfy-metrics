/**
 * lib/ops-reasons.ts — nomenclature des motifs de non-livraison (Track & Trace, point 10).
 * Partie pure (DEFAULT_REASONS, validateReasonInput, reasonLabel) importable sans base ; accès base chargés à la demande.
 * La liste par défaut est semée au PREMIER appel d'`ensureReasons` (table vide uniquement : on ne réinjecte jamais un motif supprimé).
 */
export interface ReasonRow { code: string; label: string; labelAr: string | null; kind: string; cod: boolean; rto: boolean; sort: number; active: boolean }

export const REASON_KINDS = ['NON_DELIVERY', 'POSTPONE'] as const

export const DEFAULT_REASONS: ReasonRow[] = [
  { code: 'CLIENT_ABSENT', label: 'Client absent', labelAr: 'الزبون غائب', kind: 'NON_DELIVERY', cod: false, rto: true, sort: 10, active: true },
  { code: 'REFUS_PAIEMENT_COD', label: 'Refus de paiement à la livraison', labelAr: 'رفض الدفع عند التسليم', kind: 'NON_DELIVERY', cod: true, rto: true, sort: 20, active: true },
  { code: 'ADRESSE_ERRONEE', label: 'Adresse erronée ou introuvable', labelAr: 'عنوان خاطئ أو غير موجود', kind: 'NON_DELIVERY', cod: false, rto: true, sort: 30, active: true },
  { code: 'PRODUIT_ENDOMMAGE', label: 'Produit endommagé', labelAr: 'منتج تالف', kind: 'NON_DELIVERY', cod: false, rto: true, sort: 40, active: true },
  { code: 'CLIENT_INJOIGNABLE', label: 'Client injoignable', labelAr: 'لا يمكن الاتصال بالزبون', kind: 'NON_DELIVERY', cod: false, rto: true, sort: 50, active: true },
]

const CODE_RE = /^[A-Z][A-Z0-9_]{1,39}$/

/** Valide une saisie bureau (création ou mise à jour). Renvoie l'erreur ou la ligne nettoyée. */
export function validateReasonInput(b: unknown, partial = false): { error: string } | { data: Partial<ReasonRow> } {
  const r = (b ?? {}) as Record<string, unknown>
  const out: Partial<ReasonRow> = {}
  if (!partial || r.code !== undefined) {
    const code = typeof r.code === 'string' ? r.code.trim().toUpperCase().replace(/[\s-]+/g, '_') : ''
    if (!CODE_RE.test(code)) return { error: 'Code invalide (2 à 40 caractères : lettres majuscules, chiffres, _)' }
    out.code = code
  }
  if (!partial || r.label !== undefined) {
    const label = typeof r.label === 'string' ? r.label.trim() : ''
    if (label.length < 2 || label.length > 120) return { error: 'Libellé FR requis (2 à 120 caractères)' }
    out.label = label
  }
  if (r.labelAr !== undefined) {
    const ar = typeof r.labelAr === 'string' ? r.labelAr.trim() : ''
    if (ar.length > 120) return { error: 'Libellé arabe trop long (120 caractères maximum)' }
    out.labelAr = ar || null
  }
  if (r.kind !== undefined) {
    if (typeof r.kind !== 'string' || !(REASON_KINDS as readonly string[]).includes(r.kind)) return { error: 'Type de motif invalide' }
    out.kind = r.kind
  }
  for (const k of ['cod', 'rto', 'active'] as const) if (r[k] !== undefined) { if (typeof r[k] !== 'boolean') return { error: `${k} doit être booléen` }; out[k] = r[k] as boolean }
  if (r.sort !== undefined) {
    if (typeof r.sort !== 'number' || !Number.isFinite(r.sort) || r.sort < 0 || r.sort > 9999) return { error: 'Ordre invalide (0 à 9999)' }
    out.sort = Math.round(r.sort)
  }
  return { data: out }
}

export const reasonLabel = (r: Pick<ReasonRow, 'label' | 'labelAr'>, lang: string) => (lang === 'ar' && r.labelAr ? r.labelAr : r.label)

/** Sème la liste par défaut si la table est vide (idempotent, jamais d'erreur bloquante), puis renvoie les motifs triés. */
export async function listReasons(opts: { activeOnly?: boolean } = {}): Promise<ReasonRow[]> {
  const { prisma } = await import('@/lib/prisma')
  try {
    if ((await prisma.opsReason.count()) === 0) await prisma.opsReason.createMany({ data: DEFAULT_REASONS, skipDuplicates: true })
  } catch (e) { console.warn('[ops-reasons] semis impossible:', e instanceof Error ? e.message : e) }
  const rows = await prisma.opsReason.findMany({ where: opts.activeOnly ? { active: true } : undefined, orderBy: [{ sort: 'asc' }, { code: 'asc' }] })
  return rows.map(r => ({ code: r.code, label: r.label, labelAr: r.labelAr, kind: r.kind, cod: r.cod, rto: r.rto, sort: r.sort, active: r.active }))
}

/** Le motif existe-t-il et est-il actif ? (utilisé par l'action noshow). */
export async function activeReason(code: string): Promise<ReasonRow | null> {
  const list = await listReasons({ activeOnly: true })
  return list.find(r => r.code === code) ?? null
}

/** Motif de non-livraison d'une commande (pour le détail côté bureau) ; null si la commande n'en a pas. */
export async function reasonForOrder(orderId: string): Promise<{ code: string; label: string; labelAr: string | null; cod: boolean; rto: boolean } | null> {
  const { prisma } = await import('@/lib/prisma')
  const o = await prisma.opsOrder.findUnique({ where: { id: orderId }, select: { reasonCode: true } })
  if (!o?.reasonCode) return null
  const r = await prisma.opsReason.findUnique({ where: { code: o.reasonCode } })
  return r ? { code: r.code, label: r.label, labelAr: r.labelAr, cod: r.cod, rto: r.rto } : { code: o.reasonCode, label: o.reasonCode, labelAr: null, cod: false, rto: false }
}
