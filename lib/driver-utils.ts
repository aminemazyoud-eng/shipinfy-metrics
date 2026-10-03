/**
 * lib/driver-utils.ts — Sprint 19
 *
 * Helper partagé pour dériver le nom d'un livreur à partir d'une DeliveryOrder,
 * et distinguer les commandes réellement "non assignées" (aucun nom ET aucun
 * sprintName) des commandes avec un livreur identifié.
 *
 * Avant Sprint 19, les commandes non assignées tombaient dans un faux livreur
 * "Inconnu" affiché comme n'importe quel autre dans Livreurs/Rémunération/
 * Dispatch/Prévisions — ce qui faussait classements, rémunération et assignation.
 */

export interface DriverNameFields {
  livreurFirstName: string | null
  livreurLastName:  string | null
  sprintName:       string | null
}

export const UNASSIGNED_LABEL = 'Non assignées'

export function isUnassigned(o: DriverNameFields): boolean {
  const first  = o.livreurFirstName?.trim()
  const last   = o.livreurLastName?.trim()
  const sprint = o.sprintName?.trim()
  return !first && !last && !sprint
}

export function livreurName(o: DriverNameFields): string {
  const first = o.livreurFirstName?.trim()
  const last  = o.livreurLastName?.trim()
  if (first || last) return [first, last].filter(Boolean).join(' ')
  return o.sprintName?.trim() || UNASSIGNED_LABEL
}

export interface UnassignedSummary {
  count:    number
  totalCOD: number
}

export function summarizeUnassigned<T extends DriverNameFields & { paymentOnDeliveryAmount?: number | null }>(
  orders: T[],
): UnassignedSummary {
  const unassigned = orders.filter(isUnassigned)
  return {
    count:    unassigned.length,
    totalCOD: unassigned.reduce((s, o) => s + (o.paymentOnDeliveryAmount ?? 0), 0),
  }
}
