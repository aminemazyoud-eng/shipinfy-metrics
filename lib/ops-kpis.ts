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
