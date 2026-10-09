/**
 * lib/ops-kpis.ts — KPIs de référence du secteur (Sprint 17 C2). Fonctions PURES (aucun accès base) : la route
 * GET /api/ops/kpis charge les données et appelle computeKpis. Chaque KPI porte sa FORMULE en clair (affichée au survol).
 * Une donnée absente donne `value: null` (« n/d ») et jamais 0 : un 0 mensonger est pire qu'un trou.
 */
import { isOnTime } from '@/lib/ops-defs'

type When = string | number | Date | null | undefined
export interface KpiOrder {
  status: string; slotEnd: When; deliveredAt?: When
  missingItems?: number | null; attemptCount?: number | null; cancelReason?: string | null
}
export interface KpiExtra {
  hoursWorked: number          // Σ (checkOut − checkIn) des pointages, en heures
  vehicleDaysActive: number    // couples (véhicule, jour) ayant roulé
  vehicleCount: number         // véhicules actifs de la flotte
  days: number                 // nombre de jours de la période
  pay: number | null           // paie nette (ops-pay) sur la période
  fuel: number                 // carburant (OpsFuelLog.amountMad)
  maintenance: number          // entretien (OpsMaintenance.costMad, statut « done »)
}
export interface Kpi { value: number | null; unit: '%' | 'MAD' | 'liv/h'; formula: string; num?: number; den?: number; note?: string }
export interface KpiResult {
  otif: Kpi; cancelRate: Kpi; firstAttemptSuccess: Kpi; deliveriesPerHour: Kpi; fleetUtilization: Kpi; costPerDelivery: Kpi
  cancelReasons: { reason: string; count: number }[]
  counts: { total: number; delivered: number; cancelled: number; missingItemsTracked: boolean }
  costBreakdown: { pay: number | null; fuel: number; maintenance: number }
}

// ── Sprint 19 : satisfaction client, couverture du code de remise, précision de l'ETA (fonctions pures) ──
export interface CsatResult {
  average: number | null; count: number; responseRate: number | null; distribution: Record<1 | 2 | 3 | 4 | 5, number>
  nps: number | null; formula: string; npsFormula: string
}
/** CSAT : moyenne des notes 1-5, taux de réponse (notes ÷ livrées) et NPS-like (% de 4-5 moins % de 1-2). Aucune note → null (« n/d »). */
export function computeCsat(scores: number[], deliveredCount: number): CsatResult {
  const valid = scores.filter(s => Number.isInteger(s) && s >= 1 && s <= 5)
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>
  for (const s of valid) distribution[s as 1 | 2 | 3 | 4 | 5]++
  const n = valid.length
  return {
    average: n ? r2(valid.reduce((a, b) => a + b, 0) / n) : null, count: n,
    responseRate: pct(n, deliveredCount),
    distribution,
    nps: n ? r1(((distribution[4] + distribution[5]) / n) * 100 - ((distribution[1] + distribution[2]) / n) * 100) : null,
    formula: 'CSAT = moyenne des notes (1 à 5) des clients sur la période ; taux de réponse = notes ÷ livrées × 100',
    npsFormula: 'NPS-like = % de notes 4-5 − % de notes 1-2',
  }
}

export interface OtpCoverage { value: number | null; num: number; den: number; formula: string }
/** Couverture du code de remise : livraisons dont le code a été vérifié ÷ livrées × 100. */
export function computeOtpCoverage(deliveredCount: number, verifiedCount: number): OtpCoverage {
  return { value: pct(verifiedCount, deliveredCount), num: verifiedCount, den: deliveredCount, formula: 'Couverture code de remise = livraisons avec code vérifié (otpVerifiedAt) ÷ livrées × 100' }
}

// ── Sprint 20 : preuves de livraison, conformité géographique, actions de l'application livreur (fonctions pures) ──
export interface ProofCoverage { value: number | null; num: number; den: number; formula: string }
/** Couverture des preuves : livrées avec au moins une preuve (photo OU code remis vérifié) ÷ livrées × 100. */
export function computeProofCoverage(deliveredCount: number, withProofCount: number): ProofCoverage {
  return { value: pct(withProofCount, deliveredCount), num: withProofCount, den: deliveredCount, formula: 'Couverture des preuves = livraisons avec au moins une preuve (photo ou code remis vérifié) ÷ livrées × 100' }
}

export interface GeoCompliance { value: number | null; num: number; den: number; withPosition: number; noPositionPct: number | null; formula: string }
/** Conformité géographique : parmi les livrées AVEC position, part dont deliveryGeoOk = true ; + part des livrées SANS position. */
export function computeGeoCompliance(deliveredGeoOk: (boolean | null | undefined)[]): GeoCompliance {
  const withPos = deliveredGeoOk.filter(v => v != null)
  const okN = withPos.filter(v => v === true).length
  return {
    value: pct(okN, withPos.length), num: okN, den: withPos.length, withPosition: withPos.length,
    noPositionPct: pct(deliveredGeoOk.length - withPos.length, deliveredGeoOk.length),
    formula: 'Conformité géographique = livraisons dont la position est dans le rayon autorisé (deliveryGeoOk) ÷ livraisons avec position enregistrée × 100 ; « sans position » = livrées sans coordonnées ÷ livrées',
  }
}

export interface OfflineActions { count: number | null; failed: number | null; failRate: number | null; formula: string }
/** Actions envoyées par l'application livreur (OpsDriverAction) : nombre et taux d'échec (ok = false). Aucune action → null. */
export function computeOfflineActions(total: number, failed: number): OfflineActions {
  return { count: total > 0 ? total : null, failed: total > 0 ? failed : null, failRate: pct(failed, total), formula: "Actions application livreur = nombre d'actions reçues sur la période (OpsDriverAction) ; taux d'échec = actions refusées (ok = faux) ÷ actions × 100" }
}

export interface EtaAccuracyKpi { mae: number | null; withinTolerancePct: number | null; samples: number; insufficient: boolean; formula: string }
export const ETA_ACCURACY_FORMULA = 'Précision ETA : MAE = moyenne des |ETA prédite à l\'assignation − heure réelle| en minutes (médianes hub×créneau hors commande évaluée) ; % ±15 min = part des erreurs ≤ 15 min ; n/d sous 20 livraisons'

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const pct = (num: number, den: number): number | null => (den > 0 ? r1((num / den) * 100) : null)

export function computeKpis(orders: KpiOrder[], x: KpiExtra): KpiResult {
  const delivered = orders.filter(o => o.status === 'DELIVERED')
  const cancelled = orders.filter(o => o.status === 'CANCELLED')
  const tracked = delivered.some(o => o.missingItems != null)
  const complete = (o: KpiOrder) => !o.missingItems // null ou 0 = complète

  const otifN = delivered.filter(o => isOnTime({ status: o.status, slotEnd: o.slotEnd, deliveredAt: o.deliveredAt }) && complete(o)).length
  const first = delivered.filter(o => (o.attemptCount ?? 1) <= 1).length

  const reasons = new Map<string, number>()
  for (const o of cancelled) { const k = (o.cancelReason || '').trim() || 'Non précisé'; reasons.set(k, (reasons.get(k) || 0) + 1) }

  const fleetDen = x.vehicleCount * x.days
  const cost = (x.pay ?? 0) + x.fuel + x.maintenance

  return {
    otif: {
      value: pct(otifN, delivered.length), unit: '%', num: otifN, den: delivered.length,
      formula: 'OTIF = livrées dans le créneau ET complètes ÷ livrées × 100 (complète = aucun article manquant)',
      note: tracked ? undefined : 'Articles manquants non renseignés : toutes les commandes sont supposées complètes, OTIF = taux à l\'heure.',
    },
    cancelRate: { value: pct(cancelled.length, orders.length), unit: '%', num: cancelled.length, den: orders.length, formula: 'Taux d\'annulation = commandes annulées ÷ commandes de la période × 100' },
    firstAttemptSuccess: { value: pct(first, delivered.length), unit: '%', num: first, den: delivered.length, formula: 'Réussite au 1er passage = livrées en 1 tentative (attemptCount ≤ 1) ÷ livrées × 100' },
    deliveriesPerHour: {
      value: x.hoursWorked > 0 ? r2(delivered.length / x.hoursWorked) : null, unit: 'liv/h', num: delivered.length, den: r2(x.hoursWorked),
      formula: 'Livraisons par heure = livrées ÷ heures pointées (arrivée → départ des livreurs)',
    },
    fleetUtilization: { value: pct(x.vehicleDaysActive, fleetDen), unit: '%', num: x.vehicleDaysActive, den: fleetDen, formula: 'Utilisation flotte = jours-véhicule actifs ÷ (véhicules × jours de la période) × 100' },
    costPerDelivery: {
      value: delivered.length > 0 && (x.pay != null || x.fuel > 0 || x.maintenance > 0) ? r2(cost / delivered.length) : null, unit: 'MAD', num: r2(cost), den: delivered.length,
      formula: 'Coût par livraison = (paie nette + carburant + entretien) ÷ livrées',
      note: x.pay == null ? 'Paie indisponible : coût partiel (carburant + entretien).' : undefined,
    },
    cancelReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    counts: { total: orders.length, delivered: delivered.length, cancelled: cancelled.length, missingItemsTracked: tracked },
    costBreakdown: { pay: x.pay, fuel: r2(x.fuel), maintenance: r2(x.maintenance) },
  }
}
