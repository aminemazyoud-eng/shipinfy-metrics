// Sous-modules du Dashboard (ex-onglets du Control Tower) : source unique pour la navigation (lib/module-nav.ts) et les pages.
export type BiTabKey = 'overview' | 'slots' | 'lead' | 'drivers' | 'geo' | 'clients' | 'value' | 'quality'

export interface BiTabMeta { key: BiTabKey; href: string; label: string; subtitle: string }

export const BI_TABS: BiTabMeta[] = [
  { key: 'overview', href: '/', label: 'Vue générale', subtitle: 'Volumes, répartition par magasin, jours de la semaine et heures de transmission' },
  { key: 'slots', href: '/dashboard/creneaux', label: 'Créneaux & ponctualité', subtitle: 'Respect des créneaux promis, retards et nombre de tentatives' },
  { key: 'lead', href: '/dashboard/lead-times', label: 'Lead Times', subtitle: 'Délais entre création, assignation, transport et livraison' },
  { key: 'drivers', href: '/dashboard/livreurs', label: 'Livreurs', subtitle: 'Productivité et performance détaillée par livreur et par magasin' },
  { key: 'geo', href: '/dashboard/geographie', label: 'Géographie', subtitle: 'Carte des livraisons et distances magasin → client' },
  { key: 'clients', href: '/dashboard/clients', label: 'Clients & récurrence', subtitle: 'Fréquence de commande et clients récurrents' },
  { key: 'value', href: '/dashboard/valeur', label: 'Valeur déclarée', subtitle: 'Montants à encaisser par période, magasin et créneau' },
  { key: 'quality', href: '/dashboard/qualite', label: 'Qualité des données', subtitle: 'Contrôles de cohérence et règles de calcul' },
]

export const biTab = (key: BiTabKey): BiTabMeta => BI_TABS.find(t => t.key === key)!
