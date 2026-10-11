'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  { label: 'Général', items: [
    { href: '/parametres', label: 'Général' },
    { href: '/parametres/calculs', label: 'Calculs & équations' },
  ] },
  { label: 'Opérations', items: [
    { href: '/parametres/chiffrage', label: 'Chiffrage & coûts' },
    { href: '/parametres/tournees', label: 'Tournées & ETA' },
    { href: '/parametres/secteurs', label: 'Secteurs' },
    { href: '/parametres/motifs', label: 'Motifs de non-livraison' },
    { href: '/parametres/froid', label: 'Chaîne du froid' },
  ] },
  { label: 'Équipe & paie', items: [
    { href: '/parametres/scoring', label: 'Scoring livreur' },
    { href: '/parametres/paie', label: 'Paie & bonus' },
  ] },
  { label: 'Alertes', items: [
    { href: '/parametres/notifications', label: 'Notifications & incidents' },
  ] },
  { label: 'Intégrations', items: [
    { href: '/parametres/integrations', label: 'Intégrations' },
  ] },
]

export default function ParametresLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isActive = (href: string) => pathname === href || (href !== '/parametres' && pathname.startsWith(href + '/'))
  const current = GROUPS.flatMap(g => g.items).find(i => isActive(i.href))?.href ?? '/parametres'

  return (
    <div className="lg:flex">
      {/* Mobile : liste déroulante */}
      <div className="lg:hidden bg-white border-b border-gray-200 px-3 py-2">
        <select
          aria-label="Section du paramétrage"
          value={current}
          onChange={e => router.push(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
        >
          {GROUPS.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map(i => <option key={i.href} value={i.href}>{i.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Desktop : navigation latérale */}
      <aside className="hidden lg:block w-56 flex-shrink-0 border-r border-gray-200 bg-white">
        <nav aria-label="Paramétrage" className="sticky top-0 py-4 px-2 max-h-screen overflow-y-auto">
          {GROUPS.map(g => (
            <div key={g.label} className="mb-3">
              <p className="px-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">{g.label}</p>
              {g.items.map(i => (
                <Link
                  key={i.href}
                  href={i.href}
                  aria-current={isActive(i.href) ? 'page' : undefined}
                  className={`block px-3 py-1.5 rounded-lg text-sm ${isActive(i.href) ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
                >
                  {i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
