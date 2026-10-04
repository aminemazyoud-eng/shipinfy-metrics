/**
 * lib/ops-dispatch.ts — répartition automatique (fonction pure, testable).
 * Glouton : commandes triées par créneau puis réparties au livreur qui minimise
 *   score = charge actuelle + 0,25 × distance (km) au barycentre de ses commandes déjà prises.
 * ⇒ charge équilibrée ET commandes voisines regroupées sur le même livreur.
 */
import { CFG } from '@/lib/ops-config'

export interface AutoOrder { id: string; slotStart: number; lat: number | null; lng: number | null }
export interface AutoDriver { id: string; code: string; load: number; points: [number, number][] }

const km = (a: [number, number], b: [number, number]) => {
  const x = (a[1] - b[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
  return Math.sqrt(x * x + (a[0] - b[0]) ** 2) * 111
}

export function autoAssign(orders: AutoOrder[], drivers: AutoDriver[], baseLoad: Record<string, number> = {}): { orderId: string; driverId: string }[] {
  const state = drivers.map(d => ({ ...d, load: baseLoad[d.id] ?? d.load, pts: [...d.points] }))
  const out: { orderId: string; driverId: string }[] = []
  for (const o of [...orders].sort((a, b) => a.slotStart - b.slotStart)) {
    let best = state[0], bestScore = Infinity
    for (const d of state) {
      let score = d.load
      if (o.lat != null && o.lng != null && d.pts.length) {
        const c: [number, number] = [d.pts.reduce((s, p) => s + p[0], 0) / d.pts.length, d.pts.reduce((s, p) => s + p[1], 0) / d.pts.length]
        score += CFG.autoDistWeight * km([o.lat, o.lng], c)
      }
      if (score < bestScore) { bestScore = score; best = d }
    }
    best.load++
    if (o.lat != null && o.lng != null) best.pts.push([o.lat, o.lng])
    out.push({ orderId: o.id, driverId: best.id })
  }
  return out
}
