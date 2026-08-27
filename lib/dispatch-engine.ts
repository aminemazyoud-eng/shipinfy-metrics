// ─── Dispatch Engine — Sprint 16 BLOC 3 ──────────────────────────────────────
// Pure functions only — NO DB access here. Advisory smart-dispatch helpers:
//   - computeAssignmentScore : score a single driver for taking one more order
//   - balanceLoad            : spread N orders across drivers (load balancing)
//   - detectBundles          : group nearby stops to save driver time
//
// This module is an ADVISORY planner. Nothing here writes to the database —
// there is no Assignment model in Sprint 16.

export type DriverStatus = {
  driverName:      string
  currentOrders:   number
  lastDeliveryEta: number  // minutes from now until the driver's latest deadline
  distanceToStore: number  // km — 0 in this version (no GPS)
  scoreIA:         number  // latest ReliabilityScore.score (0 if none)
}

export type AssignmentScore = {
  driverName: string
  score:      number  // lower = better candidate
  reason:     string
}

// ─── Haversine ───────────────────────────────────────────────────────────────
// Great-circle distance between two lat/lng points, in METERS.
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000 // earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// ─── Assignment score for a single driver ────────────────────────────────────
// Weighted composite — lower is better.
//   loadScore     = currentOrders * 0.4     (busy drivers penalised)
//   timeScore     = (lastDeliveryEta / 60) * 0.4  (long remaining route penalised)
//   distanceScore = distanceToStore * 0.2   (far drivers penalised)
// A driver already at/over maxOrders is "Saturé" → score 9999 (never picked
// unless everyone is saturated).
export function computeAssignmentScore(driver: DriverStatus, maxOrders = 2): AssignmentScore {
  if (driver.currentOrders >= maxOrders) {
    return { driverName: driver.driverName, score: 9999, reason: 'Saturé' }
  }
  const loadScore     = driver.currentOrders * 0.4
  const timeScore     = (driver.lastDeliveryEta / 60) * 0.4
  const distanceScore = driver.distanceToStore * 0.2
  const score = loadScore + timeScore + distanceScore
  const reason = `${driver.currentOrders} commande(s) · ETA ${driver.lastDeliveryEta}min · ${driver.distanceToStore}km`
  return { driverName: driver.driverName, score, reason }
}

// ─── Balance load across drivers ─────────────────────────────────────────────
// Greedy: for each of `orderCount` synthetic orders, recompute every driver's
// score with the running per-driver counts, pick the best, bump its count.
// Returns the driver name chosen for each slot (length === orderCount).
export function balanceLoad(drivers: DriverStatus[], orderCount: number): string[] {
  if (drivers.length === 0 || orderCount <= 0) return []

  const running = new Map<string, number>()
  for (const d of drivers) running.set(d.driverName, d.currentOrders)

  const result: string[] = []
  for (let i = 0; i < orderCount; i++) {
    let best: AssignmentScore | null = null
    for (const d of drivers) {
      const live: DriverStatus = { ...d, currentOrders: running.get(d.driverName) ?? d.currentOrders }
      const s = computeAssignmentScore(live)
      if (best === null || s.score < best.score) best = s
    }
    if (!best) break
    result.push(best.driverName)
    running.set(best.driverName, (running.get(best.driverName) ?? 0) + 1)
  }
  return result
}

// ─── Detect bundles (nearby stops that can be delivered together) ────────────
// If both orders carry lat/lng → Haversine distance <= radiusMeters groups them.
// Otherwise fall back to a normalised address prefix (first token / postal code)
// or the `zone` field.
// estimatedSaving = (groupSize - 1) * 8
//   Heuristic: bundling a stop into an existing run saves ~8 minutes of drive +
//   park + handover time versus dispatching it as a standalone trip.
export function detectBundles(
  orders: { id: string; address: string; lat?: number; lng?: number; zone?: string }[],
  radiusMeters = 500,
): { bundles: { orderIds: string[]; zone: string; estimatedSaving: number }[] } {
  const bundles: { orderIds: string[]; zone: string; estimatedSaving: number }[] = []
  const used = new Set<string>()

  const hasGeo = (o: { lat?: number; lng?: number }) =>
    typeof o.lat === 'number' && typeof o.lng === 'number' &&
    !Number.isNaN(o.lat) && !Number.isNaN(o.lng)

  const normKey = (o: { address: string; zone?: string }) => {
    if (o.zone && o.zone.trim()) return o.zone.trim().toLowerCase()
    const first = (o.address ?? '').trim().split(/[\s,]+/)[0] ?? ''
    return first.toLowerCase()
  }

  // 1. Geo-based grouping
  for (const a of orders) {
    if (used.has(a.id) || !hasGeo(a)) continue
    const group = [a]
    used.add(a.id)
    for (const b of orders) {
      if (used.has(b.id) || !hasGeo(b)) continue
      const d = haversineMeters(a.lat as number, a.lng as number, b.lat as number, b.lng as number)
      if (d <= radiusMeters) {
        group.push(b)
        used.add(b.id)
      }
    }
    if (group.length >= 2) {
      bundles.push({
        orderIds: group.map(o => o.id),
        zone: group[0].zone?.trim() || normKey(group[0]) || '—',
        estimatedSaving: (group.length - 1) * 8,
      })
    } else {
      // released back for address-based pass
      used.delete(a.id)
    }
  }

  // 2. Address / zone prefix grouping for anything not yet bundled
  const remaining = orders.filter(o => !used.has(o.id))
  const byKey = new Map<string, typeof remaining>()
  for (const o of remaining) {
    const k = normKey(o)
    if (!k) continue
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(o)
  }
  for (const [key, group] of byKey) {
    if (group.length < 2) continue
    bundles.push({
      orderIds: group.map(o => o.id),
      zone: group[0].zone?.trim() || key || '—',
      estimatedSaving: (group.length - 1) * 8,
    })
  }

  return { bundles }
}
