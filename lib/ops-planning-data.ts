import { prisma } from '@/lib/prisma'
import { loadOrders, loadHubs, loadDrivers, opsNow } from '@/lib/ops-data'
import { forecastDay } from '@/lib/ops-analytics'
import { normalizePhone, type PlanTeam } from '@/lib/ops-planning'

/** Commandes prévues par hub et par créneau pour un jour (même moteur que le Cockpit → Prévisions). */
export async function planDemand(day: string): Promise<Record<string, Record<string, number>>> {
  const now = await opsNow(); const dayMs = Date.parse(day + 'T00:00:00Z')
  const [orders, hubs, drivers] = await Promise.all([loadOrders(new Date(dayMs - 43 * 86_400_000), new Date(dayMs + 86_400_000)), loadHubs(), loadDrivers()])
  const f = forecastDay(orders, hubs, drivers, day, now)
  const out: Record<string, Record<string, number>> = {}
  for (const h of f.hubs) { out[h.code] = {}; for (const s of f.slots) out[h.code][s] = h.cells[s].expected }
  return out
}

/** Équipes du planning d'un jour (chauffeur + helper(s) du même véhicule), prêtes pour les PDF. */
export async function loadTeams(day: string, onlyCodes?: string[]): Promise<PlanTeam[]> {
  const lines = await prisma.opsPlanLine.findMany({ where: { day, ...(onlyCodes?.length ? { driverCode: { in: onlyCodes } } : {}) }, orderBy: [{ hubCode: 'asc' }, { departTime: 'asc' }] })
  if (!lines.length) return []
  const [hubs, drivers] = await Promise.all([
    prisma.opsHub.findMany(),
    prisma.opsDriver.findMany({ where: { code: { in: lines.map(l => l.driverCode) } }, include: { vehicle: { include: { crew: { where: { jobType: 'helper', status: { not: 'off' } } } } } } }),
  ])
  const hubBy = new Map(hubs.map(h => [h.code, h])), hubById = new Map(hubs.map(h => [h.id, h])), drvBy = new Map(drivers.map(d => [d.code, d]))
  const teams: PlanTeam[] = []
  for (const l of lines) {
    const d = drvBy.get(l.driverCode), hub = hubBy.get(l.hubCode); if (!d || !hub) continue
    const home = d.homeHubId ? hubById.get(d.homeHubId) : null
    const homeName = home?.name ?? null
    let demand: Record<string, number> | null = null; try { demand = l.demand ? JSON.parse(l.demand) : null } catch { /* ignore */ }
    teams.push({
      day, hubCode: hub.code, hubName: hub.name, hubCity: hub.city, hubLat: hub.lat, hubLng: hub.lng, homeHubName: homeName,
      departTime: l.departTime, slots: l.slots ? l.slots.split(',').filter(Boolean) : [], note: l.note, vehicle: d.vehicle?.type ?? null, plate: d.vehicle?.plate ?? null, demand,
      crew: [
        { code: d.code, name: `${d.firstName} ${d.lastName}`, phone: normalizePhone(d.phone), role: 'chauffeur', homeHub: homeName },
        ...(d.vehicle?.crew ?? []).map(h => ({ code: h.code, name: `${h.firstName} ${h.lastName}`, phone: normalizePhone(h.phone), role: 'helper' as const, homeHub: homeName })),
      ],
    })
  }
  return teams
}
