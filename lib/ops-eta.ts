/**
 * lib/ops-eta.ts — ETA de livraison v1 + mesure de précision (Sprint 19, reco 8 de l'audit).
 * Méthode : ETA = instant de l'étape courante + MÉDIANE historique de la durée restante jusqu'à la livraison, pour le même hub et le
 * même créneau canonique (30 derniers jours de commandes LIVRÉES) ; repli sur la médiane du créneau (tous hubs), puis sur la fin du
 * créneau promis. Jamais d'ETA dans le passé (au minimum maintenant + 5 min).
 * Les fonctions de calcul sont PURES (testées sans base) ; l'accès base est importé à l'usage (import dynamique de prisma).
 */
import { canonicalSlot } from '@/lib/ops-slots'

export type EtaStage = 'READY_PICKUP' | 'ASSIGNED' | 'IN_TRANSPORT' | 'START_DELIVERY'
export const ETA_MIN_SAMPLES = 3          // en dessous, la médiane n'est pas jugée fiable : repli au niveau suivant
export const ETA_MIN_AHEAD_MIN = 5        // jamais d'ETA plus proche que maintenant + 5 min
export const ETA_LOOKBACK_DAYS = 30
const MAX_REMAINING_MIN = 12 * 60         // une « durée restante » > 12 h est une donnée aberrante, ignorée

/** Livraison passée : instants (ms) de chaque étape + livraison. */
export interface EtaSample { id: string; hubCode: string | null; slot: string; at: Partial<Record<EtaStage, number>>; deliveredAt: number }
/** Commande à prédire : statut courant, instant de l'étape courante, créneau canonique et fin de créneau promise (ms). */
export interface EtaOrder { id?: string; status: string; hubCode: string | null; slot: string; stageAt: number | null; slotEnd: number }
export interface EtaResult { etaAt: string | null; basis: string }

const STAGE_OF: Record<string, EtaStage> = { READY_PICKUP: 'READY_PICKUP', ASSIGNED: 'ASSIGNED', IN_TRANSPORT: 'IN_TRANSPORT', START_DELIVERY: 'START_DELIVERY' }

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Durées restantes (minutes) entre l'étape `stage` et la livraison, pour un ensemble de livraisons passées. */
function remaining(samples: EtaSample[], stage: EtaStage, match: (s: EtaSample) => boolean, excludeId?: string): number[] {
  const out: number[] = []
  for (const s of samples) {
    if (s.id === excludeId || !match(s)) continue
    const t = s.at[stage]
    if (t == null) continue
    const min = (s.deliveredAt - t) / 60_000
    if (min > 0 && min <= MAX_REMAINING_MIN) out.push(min)
  }
  return out
}

/**
 * ETA d'une commande ouverte. `nowMs` borne le résultat (jamais dans le passé). `excludeId` = leave-one-out (mesure de précision).
 * Renvoie `source` pour distinguer une prédiction statistique du repli sur le créneau promis.
 */
export function predictEtaFrom(order: EtaOrder, samples: EtaSample[], nowMs = Date.now()): EtaResult & { source: 'hub-slot' | 'slot' | 'promise' | 'none'; n: number } {
  if (order.status === 'DELIVERED' || order.status === 'NO_SHOW' || order.status === 'CANCELLED') return { etaAt: null, basis: 'Commande terminée', source: 'none', n: 0 }
  const floor = nowMs + ETA_MIN_AHEAD_MIN * 60_000
  const stage = STAGE_OF[order.status]
  const t0 = order.stageAt
  if (stage && t0 != null) {
    const hub = order.hubCode ? remaining(samples, stage, s => s.hubCode === order.hubCode && s.slot === order.slot, order.id) : []
    if (hub.length >= ETA_MIN_SAMPLES) {
      const m = median(hub) as number
      return { etaAt: new Date(Math.max(floor, t0 + m * 60_000)).toISOString(), basis: `médiane hub×créneau sur ${hub.length} livraisons`, source: 'hub-slot', n: hub.length }
    }
    const slot = remaining(samples, stage, s => s.slot === order.slot, order.id)
    if (slot.length >= ETA_MIN_SAMPLES) {
      const m = median(slot) as number
      return { etaAt: new Date(Math.max(floor, t0 + m * 60_000)).toISOString(), basis: `médiane du créneau (tous hubs) sur ${slot.length} livraisons`, source: 'slot', n: slot.length }
    }
  }
  return { etaAt: new Date(Math.max(floor, order.slotEnd)).toISOString(), basis: 'fin du créneau promis (historique insuffisant)', source: 'promise', n: 0 }
}

// ── Mesure de précision (pure) ──────────────────────────────────────────────────────────────────────────────────────────────
export const ETA_MIN_ACCURACY_SAMPLES = 20
export const ETA_TOLERANCE_MIN = 15
export type EtaAccuracy =
  | { insufficient: true; samples: number; mae: null; withinTolerancePct: null }
  | { insufficient: false; samples: number; mae: number; withinTolerancePct: number }

/**
 * Pour chaque livraison de la période : ETA qu'on AURAIT prédite à l'assignation (médianes calculées SANS la commande évaluée),
 * comparée à l'heure réelle. Seules les prédictions statistiques comptent (le repli « fin de créneau » n'est pas une ETA apprise).
 * `pool` = historique disponible (au minimum les livraisons évaluées) ; `evaluated` = livraisons de la période ayant un instant d'assignation.
 */
export function computeEtaAccuracy(evaluated: EtaSample[], pool: EtaSample[] = evaluated): EtaAccuracy {
  const errs: number[] = []
  for (const s of evaluated) {
    const assignedAt = s.at.ASSIGNED
    if (assignedAt == null || s.deliveredAt <= assignedAt) continue
    const p = predictEtaFrom({ id: s.id, status: 'ASSIGNED', hubCode: s.hubCode, slot: s.slot, stageAt: assignedAt, slotEnd: s.deliveredAt }, pool, assignedAt - ETA_MIN_AHEAD_MIN * 60_000)
    if (p.source === 'promise' || !p.etaAt) continue
    errs.push(Math.abs(Date.parse(p.etaAt) - s.deliveredAt) / 60_000)
  }
  if (errs.length < ETA_MIN_ACCURACY_SAMPLES) return { insufficient: true, samples: errs.length, mae: null, withinTolerancePct: null }
  const mae = errs.reduce((a, b) => a + b, 0) / errs.length
  return { insufficient: false, samples: errs.length, mae: Math.round(mae * 10) / 10, withinTolerancePct: Math.round((errs.filter(e => e <= ETA_TOLERANCE_MIN).length / errs.length) * 1000) / 10 }
}

// ── Accès base ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Row = { id: string; hubCode: string | null; slotStart: Date; createdAtSrc: Date | null; assignedAt: Date | null; inTransportAt: Date | null; startDeliveryAt: Date | null; deliveredAt: Date | null }
const SEL = { id: true, hubCode: true, slotStart: true, createdAtSrc: true, assignedAt: true, inTransportAt: true, startDeliveryAt: true, deliveredAt: true } as const

function toSample(r: Row): EtaSample | null {
  if (!r.deliveredAt) return null
  const at: EtaSample['at'] = {}
  if (r.createdAtSrc) at.READY_PICKUP = r.createdAtSrc.getTime()
  if (r.assignedAt) at.ASSIGNED = r.assignedAt.getTime()
  if (r.inTransportAt) at.IN_TRANSPORT = r.inTransportAt.getTime()
  if (r.startDeliveryAt) at.START_DELIVERY = r.startDeliveryAt.getTime()
  return { id: r.id, hubCode: r.hubCode, slot: canonicalSlot(r.slotStart), at, deliveredAt: r.deliveredAt.getTime() }
}

async function loadSamples(from: Date, to: Date, hub?: string): Promise<EtaSample[]> {
  const { prisma } = await import('@/lib/prisma')
  const rows = await prisma.opsOrder.findMany({ where: { status: 'DELIVERED', deliveredAt: { gte: from, lt: to }, ...(hub ? { hubCode: hub } : {}) }, select: SEL, take: 50_000 })
  return rows.map(toSample).filter((s): s is EtaSample => s !== null)
}

/** ETA d'une commande : null si terminée / annulée / introuvable. Statistiques mises en cache 5 min. */
export async function etaForOrder(orderId: string): Promise<{ etaAt: string | null; basis: string }> {
  const { prisma } = await import('@/lib/prisma')
  const { cached } = await import('@/lib/ops-cache')
  const o = await prisma.opsOrder.findUnique({ where: { id: orderId }, select: { ...SEL, status: true, slotEnd: true } })
  if (!o) return { etaAt: null, basis: 'Commande introuvable' }
  const stageAt = o.status === 'START_DELIVERY' ? o.startDeliveryAt : o.status === 'IN_TRANSPORT' ? o.inTransportAt : o.status === 'ASSIGNED' ? o.assignedAt : o.status === 'READY_PICKUP' ? o.createdAtSrc : null
  const now = Date.now()
  const samples = await cached('eta-samples', 5 * 60_000, () => loadSamples(new Date(now - ETA_LOOKBACK_DAYS * 86_400_000), new Date(now + 86_400_000)))
  const p = predictEtaFrom({ id: o.id, status: o.status, hubCode: o.hubCode, slot: canonicalSlot(o.slotStart), stageAt: stageAt?.getTime() ?? null, slotEnd: o.slotEnd.getTime() }, samples, now)
  return { etaAt: p.etaAt, basis: p.basis }
}

/** Précision de l'ETA sur une période de jours locaux (YYYY-MM-DD) : MAE (min), % dans ±15 min, nombre d'échantillons. */
export async function etaAccuracy(from: string, to: string, hub?: string): Promise<EtaAccuracy> {
  const { dayBoundsTz } = await import('@/lib/tz')
  const a = dayBoundsTz(from).from, b = dayBoundsTz(to).to
  const evaluated = await loadSamples(a, b, hub)
  return computeEtaAccuracy(evaluated)
}
