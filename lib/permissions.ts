// ─── Module permissions — single source of truth ────────────────────────────
// Safe for Edge runtime (no Node.js imports, no Prisma)

export const ALL_ROLES = [
  'VIEWER', 'SUPPORT', 'DISPATCHER', 'COORDINATOR', 'MANAGER', 'ADMIN', 'SUPER_ADMIN',
] as const

export type RoleKey = typeof ALL_ROLES[number]

// Module key → route prefixes that belong to it
export const MODULE_ROUTES: Record<string, string[]> = {
  dashboard:    ['/', '/kpis', '/previsions'],
  operations:   ['/operations', '/operations/dispatch', '/operations/suivi', '/operations/encaissement', '/operations/pointage', '/operations/flotte', '/operations/historique'],
  livreurs:     ['/livreurs', '/score-ia', '/performance/analyse'],
  journal:      ['/admin/journal'],
  remuneration: ['/remuneration'],
  hubs:         ['/hubs', '/retours'],
  dispatch:     ['/dispatch'],
  picking:      ['/picking'],
  shifts:       ['/shifts'],
  alertes:      ['/alertes', '/incidents'],
  rapports:     ['/rapports'],
  notifications:['/notifications'],
  support:      ['/support'],
  rh:           ['/pointage', '/onboarding', '/academy', '/rh', '/rh/onboarding', '/rh/paie', '/rh/pointage'],
  parametres:   ['/parametres', '/parametres/calculs', '/parametres/scoring', '/parametres/paie', '/parametres/notifications'],
  admin:        ['/admin'],
}

// Role → set of allowed module keys
export const ROLE_MODULES: Record<RoleKey, Set<string>> = {
  SUPER_ADMIN:  new Set(Object.keys(MODULE_ROUTES)),
  ADMIN:        new Set(['journal','dashboard','operations','livreurs','remuneration','hubs','dispatch','picking','shifts','alertes','rapports','notifications','support','rh','parametres']),
  MANAGER:      new Set(['dashboard','operations','livreurs','remuneration','hubs','dispatch','picking','shifts','alertes','rapports','notifications','support','rh','parametres']),
  COORDINATOR:  new Set(['dashboard','operations','livreurs','dispatch','picking','shifts','alertes','notifications','rh','parametres']),
  DISPATCHER:   new Set(['dashboard','operations','dispatch','picking','alertes']),
  SUPPORT:      new Set(['dashboard','alertes','support']),
  VIEWER:       new Set(['dashboard']),
}

// Returns true if the given role can access the given pathname
export function canAccess(role: string, pathname: string): boolean {
  const allowed = ROLE_MODULES[role as RoleKey]
  if (!allowed) return false

  for (const [module, routes] of Object.entries(MODULE_ROUTES)) {
    if (!allowed.has(module)) continue
    for (const route of routes) {
      if (route === '/' ? pathname === '/' : pathname === route || pathname.startsWith(route + '/')) {
        return true
      }
    }
  }
  return false
}

// Returns all allowed route prefixes for a role (used by Sidebar to filter nav items)
export function getAllowedRoutes(role: string): string[] {
  const allowed = ROLE_MODULES[role as RoleKey]
  if (!allowed) return getAllowedRoutes('VIEWER')
  return Object.entries(MODULE_ROUTES)
    .filter(([module]) => allowed.has(module))
    .flatMap(([, routes]) => routes)
}
