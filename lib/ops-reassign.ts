/**
 * lib/ops-reassign.ts — réaffectation automatique (Sprint 21). Fonction pure : PROPOSE, n'écrit rien.
 * Une commande ouverte (non en livraison) est à réaffecter si son livreur est indisponible (no-show / absent)
 * ou si elle est en retard de plus de `lateMinutes` ; la cible est choisie par autoAssign parmi les livreurs disponibles.
 */
import { autoAssign, type AutoDriver, type AutoOrder } from '@/lib/ops-dispatch'
import { isOpen } from '@/lib/ops-defs'

export interface ReassignOrder extends AutoOrder { status: string; driverId: string | null; slotEnd: number }
export interface ReassignDriver extends AutoDriver { available: boolean }
export interface Reassignment { orderId: string; from: string | null; to: string; reason: 'driver_unavailable' | 'late' }

export function proposeReassignments(orders: ReassignOrder[], drivers: ReassignDriver[], nowMs: number, lateMinutes = 20): Reassignment[] {
  const byId = new Map(drivers.map(d => [d.id, d]))
  const reason = new Map<string, Reassignment['reason']>()
  const todo: ReassignOrder[] = []
  for (const o of orders) {
    if (!isOpen(o) || o.status === 'START_DELIVERY' || o.status === 'READY_PICKUP' || !o.driverId) continue
    const d = byId.get(o.driverId)
    if (d && !d.available) { reason.set(o.id, 'driver_unavailable'); todo.push(o) }
    else if (nowMs - o.slotEnd > lateMinutes * 60_000) { reason.set(o.id, 'late'); todo.push(o) }
  }
  const pool = drivers.filter(d => d.available)
  if (!todo.length || !pool.length) return []
  return autoAssign(todo, pool).filter(a => a.driverId !== byId.get(todo.find(o => o.id === a.orderId)!.driverId!)?.id)
    .map(a => ({ orderId: a.orderId, from: orders.find(o => o.id === a.orderId)!.driverId, to: a.driverId, reason: reason.get(a.orderId)! }))
}
