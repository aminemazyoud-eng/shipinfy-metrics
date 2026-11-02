/**
 * lib/ops-planning-auto.ts — planning auto-proposé « type Deputy » (Sprint 21). Fonction pure : PROPOSE, la validation reste humaine.
 * Pour chaque hub : équipes nécessaires = ceil(commandes prévues / capacité par équipe) ; on y met d'abord les chauffeurs dont c'est le hub
 * d'origine, puis on comble avec les chauffeurs disponibles d'autres hubs (marqués `borrowed`). Manque signalé dans `shortfall`.
 */
export interface PlanDriver { code: string; homeHub: string | null; available: boolean }
export interface HubDemand { hub: string; forecast: number }
export interface ProposedTeam { hub: string; driver: string; borrowed: boolean }
export interface PlanProposal { teams: ProposedTeam[]; shortfall: Record<string, number> }

export function proposePlanning(demand: HubDemand[], drivers: PlanDriver[], perTeam = 25): PlanProposal {
  const free = new Set(drivers.filter(d => d.available).map(d => d.code))
  const byCode = new Map(drivers.map(d => [d.code, d]))
  const need = new Map(demand.map(d => [d.hub, Math.ceil(Math.max(0, d.forecast) / perTeam)]))
  const teams: ProposedTeam[] = []
  const missing = new Map<string, number>()
  for (const [hub, n] of [...need].sort((a, b) => b[1] - a[1])) {
    let left = n
    for (const c of [...free].filter(c => byCode.get(c)!.homeHub === hub).sort()) { if (!left) break; teams.push({ hub, driver: c, borrowed: false }); free.delete(c); left-- }
    missing.set(hub, left)
  }
  for (const [hub, left0] of missing) {
    let left = left0
    for (const c of [...free].sort()) { if (!left) break; teams.push({ hub, driver: c, borrowed: true }); free.delete(c); left-- }
    missing.set(hub, left)
  }
  const shortfall: Record<string, number> = {}
  for (const [hub, left] of missing) if (left > 0) shortfall[hub] = left
  return { teams, shortfall }
}
