'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity, BarChart3, Users, MapPin, XCircle,
  TrendingUp, Bell, Mail, Settings, UserCheck, GraduationCap,
} from 'lucide-react'

const sections = [
  {
    label: 'Analytics',
    items: [
      { href: '/',     label: 'Dashboard Temps Réel', icon: Activity },
      { href: '/kpis', label: 'KPIs & Métriques',     icon: BarChart3 },
    ],
  },
  {
    label: 'Performance',
    items: [
      { href: '/livreurs',  label: 'Livreurs',         icon: Users     },
      { href: '/hubs',      label: 'Hubs',              icon: MapPin    },
      { href: '/retours',   label: 'Retours & NO_SHOW', icon: XCircle   },
      { href: '/previsions',label: 'Prévisions',        icon: TrendingUp },
    ],
  },
  {
    label: 'Opérations',
    items: [
      { href: '/alertes',  label: 'Alertes & Tickets', icon: Bell },
      { href: '/rapports', label: 'Rapports',           icon: Mail },
    ],
  },
  {
    label: 'RH & Formation',
    items: [
      { href: '/onboarding', label: 'Onboarding',  icon: UserCheck     },
      { href: '/academy',    label: 'Academy',     icon: GraduationCap },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      {/* Brand */}
      <div className="p-5 border-b border-gray-200">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
            S
          </div>
          <div>
            <h1 className="text-[15px] font-black text-blue-700 leading-none">SHIPINFY</h1>
            <p className="text-[10px] text-gray-400 mt-0.5">Metrics & Analytics</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
        {sections.map(section => (
          <div key={section.label}>
            <div className="px-3 mb-1.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                {section.label}
              </span>
            </div>
            <div className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || (href !== '/' && pathname.startsWith(href))
                const isComingSoon = href === '/previsions'
                return (
                  <Link
                    key={href}
                    href={isComingSoon ? '#' : href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                      ${active
                        ? 'bg-blue-50 text-blue-700'
                        : isComingSoon
                          ? 'text-gray-300 cursor-not-allowed'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                  >
                    <Icon size={16} />
                    <span className="flex-1 truncate">{label}</span>
                    {isComingSoon && (
                      <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-medium">
                        Soon
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-gray-200">
        <Link
          href="/parametres"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <Settings size={16} />
          Paramètres
        </Link>
        <div className="mt-2 px-3 py-2 bg-blue-50 rounded-lg">
          <p className="text-[10px] font-semibold text-blue-600">SHIPINFY v3.0</p>
          <p className="text-[10px] text-blue-400">Sprint 1→5 — Full Platform</p>
        </div>
      </div>
    </aside>
  )
}
