'use client'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { Menu, Bell } from 'lucide-react'

const ROUTE_LABELS: Record<string, string> = {
  '/':             'Dashboard',
  '/kpis':         'KPIs & Métriques',
  '/previsions':   'Prévisions',
  '/livreurs':     'Livreurs',
  '/remuneration': 'Rémunération',
  '/hubs':         'Hubs',
  '/retours':      'Retours & NO_SHOW',
  '/alertes':      'Alertes & Tickets',
  '/rapports':     'Rapports',
  '/dispatch':     'Dispatch',
  '/pointage':     'Pointage',
  '/support':      'Support Client',
  '/onboarding':   'Onboarding',
  '/academy':      'Academy',
  '/score-ia':     'Score IA',
  '/parametres':   'Paramètres',
  '/admin':        'Super Admin',
  '/shifts':       'Shifts & Planning',
}

interface Props {
  onMenuClick: () => void
}

export default function MobileHeader({ onMenuClick }: Props) {
  const pathname = usePathname()
  const label = ROUTE_LABELS[pathname] ?? 'Shipinfy'

  return (
    <header className="lg:hidden sticky top-0 z-40 h-14 bg-white/90 backdrop-blur-md border-b border-gray-100 flex items-center px-3 gap-3">
      {/* Hamburger */}
      <button
        onClick={onMenuClick}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:scale-95 transition-transform duration-100"
        aria-label="Menu"
      >
        <Menu size={20} />
      </button>

      {/* Logo */}
      <div className="w-7 h-7 relative flex-shrink-0">
        <Image src="/logo.png" alt="Shipinfy" width={28} height={28} className="object-contain" />
      </div>

      {/* Page title */}
      <span className="flex-1 text-sm font-bold text-gray-800 truncate">{label}</span>

      {/* Actions */}
      <button className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 active:scale-95 transition-transform duration-100 relative">
        <Bell size={18} />
      </button>

      {/* User avatar */}
      <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] font-bold text-white">SH</span>
      </div>
    </header>
  )
}
