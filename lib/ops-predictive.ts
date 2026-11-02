/**
 * lib/ops-predictive.ts — alertes SLA prédictives (Sprint 21). Fonction pure.
 * Pour chaque livreur : vitesse réelle du jour (minutes/commande entre livraisons) ou repli ; la file restante est
 * déroulée dans l'ordre des créneaux ; toute commande dont l'arrivée prévue dépasse la fin de créneau est signalée AVANT le retard.
 */
export interface PredOrder { id: string; driverId: string; slotEnd: number; open: boolean; deliveredAt?: number | null }
export interface Prediction { orderId: string; driverId: string; etaMs: number; overrunMin: number }

/** Minutes moyennes par commande d'après les livraisons réelles (>= 3 pour être fiable), sinon `fallbackMin`. */
export function driverPace(deliveredAts: number[], fallbackMin = 25): number {
  const t = [...deliveredAts].sort((a, b) => a - b)
  if (t.length < 3) return fallbackMin
  const gaps = t.slice(1).map((v, i) => (v - t[i]) / 60_000).filter(g => g > 0 && g < 120)
  return gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : fallbackMin
}

export function predictOverruns(orders: PredOrder[], nowMs: number, fallbackMin = 25, toleranceMin = 0): Prediction[] {
  const byDriver = new Map<string, PredOrder[]>()
  for (const o of orders) (byDriver.get(o.driverId) ?? byDriver.set(o.driverId, []).get(o.driverId)!).push(o)
  const out: Prediction[] = []
  for (const [driverId, list] of byDriver) {
    const pace = driverPace(list.filter(o => o.deliveredAt).map(o => o.deliveredAt!), fallbackMin)
    let t = nowMs
    for (const o of list.filter(o => o.open).sort((a, b) => a.slotEnd - b.slotEnd)) {
      t += pace * 60_000
      const overrun = Math.round((t - o.slotEnd) / 60_000)
      if (overrun > toleranceMin) out.push({ orderId: o.id, driverId, etaMs: t, overrunMin: overrun })
    }
  }
  return out.sort((a, b) => b.overrunMin - a.overrunMin)
}
