'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/operations', label: 'Cockpit' },
  { href: '/operations/dispatch', label: 'Dispatch live' },
  { href: '/operations/suivi', label: 'Suivi commandes' },
  { href: '/operations/encaissement', label: 'Encaissement' },
  { href: '/operations/pointage', label: 'Pointage & paie' },
  { href: '/operations/flotte', label: 'Flotte & gasoil' },
  { href: '/operations/historique', label: 'Historique' },
  { href: '/operations/tournees', label: 'Tournées' },
  { href: '/operations/controle', label: 'Tour de contrôle' },
  { href: '/operations/vagues', label: 'Vagues de préparation' },
  { href: '/operations/secteurs', label: 'Secteurs' },
  { href: '/operations/chiffrage', label: 'Chiffrage' },
  { href: '/operations/froid', label: 'Chaîne du froid' },
  { href: '/operations/integrations', label: 'Intégrations' },
]

export default function OpsNav() {
  const path = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 mb-4">
      {LINKS.map(l => {
        const active = l.href === '/operations' ? path === '/operations' : path.startsWith(l.href)
        return (
          <Link key={l.href} href={l.href} className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${active ? 'border-purple-600 text-purple-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
