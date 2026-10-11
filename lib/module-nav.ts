// Navigation à 7 modules + onglets par module (source unique pour Sidebar, AppShell, MobileHeader, ModuleTabs)
import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import { Activity, LayoutDashboard, Users, Truck, LifeBuoy, Settings, Shield } from 'lucide-react'
import { canAccess } from '@/lib/permissions'

export interface ModuleTab {
  href: string
  label: string
  /** Préfixes supplémentaires (pages absorbées / anciennes URLs) rattachés à cet onglet */
  aliases?: string[]
}
export interface NavModule {
  key: string
  label: string
  icon: ComponentType<LucideProps>
  /** URL d'entrée (premier onglet) */
  href: string
  tabs: ModuleTab[]
  /** Préfixes rattachés au module sans onglet dédié (ex. incidents, paramétrage) */
  aliases?: string[]
}

export const NAV_MODULES: NavModule[] = [
  {
    key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/',
    tabs: [
      { href: '/', label: 'Vue d’ensemble' },
      { href: '/kpis', label: 'KPIs' },
      { href: '/hubs', label: 'Hubs' },
      { href: '/retours', label: 'Retours' },
      { href: '/previsions', label: 'Prévisions' },
      { href: '/performance/analyse', label: 'Metrics' },
      { href: '/rapports', label: 'Rapports planifiés' },
    ],
  },
  {
    key: 'cockpit', label: 'Cockpit live', icon: Activity, href: '/operations',
    tabs: [
      { href: '/operations', label: 'Cockpit' },
      { href: '/operations/dispatch', label: 'Dispatch', aliases: ['/dispatch'] },
      { href: '/operations/suivi', label: 'Commandes', aliases: ['/operations/historique'] },
      { href: '/operations/tournees', label: 'Tournées' },
      { href: '/operations/vagues', label: 'Vagues', aliases: ['/picking'] },
      { href: '/operations/controle', label: 'Contrôle' },
      { href: '/operations/encaissement', label: 'Encaissement' },
    ],
  },
  {
    key: 'equipe', label: 'Équipe', icon: Users, href: '/livreurs',
    tabs: [
      { href: '/livreurs', label: 'Livreurs' },
      { href: '/score-ia', label: 'Score IA' },
      { href: '/shifts', label: 'Planning' },
      { href: '/rh/pointage', label: 'Pointage', aliases: ['/pointage', '/operations/pointage'] },
      { href: '/rh/paie', label: 'Paie', aliases: ['/remuneration'] },
      { href: '/rh/onboarding', label: 'Recrutement', aliases: ['/onboarding'] },
      { href: '/academy', label: 'Academy' },
    ],
  },
  {
    key: 'flotte', label: 'Flotte & coûts', icon: Truck, href: '/operations/flotte',
    tabs: [
      { href: '/operations/flotte', label: 'Véhicules & gasoil' },
      { href: '/operations/chiffrage', label: 'Chiffrage' },
      { href: '/operations/froid', label: 'Chaîne du froid' },
    ],
  },
  {
    key: 'incidents', label: 'Incidents & support', icon: LifeBuoy, href: '/incidents',
    tabs: [{ href: '/incidents', label: 'Incidents & support', aliases: ['/alertes', '/support', '/notifications'] }],
  },
  {
    key: 'parametres', label: 'Paramétrage', icon: Settings, href: '/parametres',
    tabs: [{ href: '/parametres', label: 'Paramétrage' }],
  },
  {
    key: 'admin', label: 'Admin', icon: Shield, href: '/admin',
    tabs: [
      { href: '/admin', label: 'Super Admin' },
      { href: '/admin/journal', label: 'Journal des actions' },
    ],
  },
]

function prefixMatch(pathname: string, prefix: string): number {
  if (prefix === '/') return pathname === '/' ? 1 : 0
  return pathname === prefix || pathname.startsWith(prefix + '/') ? prefix.length : 0
}

export interface ActiveNav {
  module: NavModule
  tab: ModuleTab
}

/** Module + onglet actifs pour un chemin (plus long préfixe gagnant). */
export function getActiveNav(pathname: string): ActiveNav | null {
  let best: ActiveNav | null = null
  let bestLen = 0
  for (const module of NAV_MODULES) {
    for (const tab of module.tabs) {
      for (const p of [tab.href, ...(tab.aliases ?? [])]) {
        const len = prefixMatch(pathname, p)
        if (len > bestLen) { best = { module, tab }; bestLen = len }
      }
    }
  }
  return best
}

/** Onglets d'un module visibles pour un rôle. */
export function visibleTabs(module: NavModule, role: string): ModuleTab[] {
  return module.tabs.filter(t => canAccess(role, t.href))
}

/** Modules visibles pour un rôle, avec URL d'entrée = premier onglet autorisé. */
export function visibleModules(role: string): (NavModule & { entry: string })[] {
  return NAV_MODULES
    .map(m => {
      const tabs = visibleTabs(m, role)
      return tabs.length ? { ...m, entry: tabs[0].href } : null
    })
    .filter((m): m is NavModule & { entry: string } => m !== null)
}
