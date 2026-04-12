'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Activity, BarChart3, Users, MapPin, XCircle,
  TrendingUp, Bell, Mail, Settings, UserCheck,
  GraduationCap, Brain, X, ChevronRight, DollarSign,
  Truck, Clock, HeadphonesIcon, Shield, Calendar,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import MobileHeader from '@/components/MobileHeader'
import BottomNav from '@/components/BottomNav'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { getAllowedRoutes } from '@/lib/permissions'

// ── Nav items (mirrors Sidebar.tsx) ────────────────────────────────────────────
interface NavItem { href: string; label: string; icon: React.ComponentType<LucideProps> }
interface NavSection { key: string; label: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    key: 'analytics', label: 'Analytics',
    items: [
      { href: '/',           label: 'Dashboard',        icon: Activity   },
      { href: '/kpis',       label: 'KPIs & Métriques', icon: BarChart3  },
      { href: '/previsions', label: 'Prévisions',        icon: TrendingUp },
    ],
  },
  {
    key: 'performance', label: 'Performance',
    items: [
      { href: '/livreurs',     label: 'Livreurs',          icon: Users      },
      { href: '/remuneration', label: 'Rémunération',     icon: DollarSign },
      { href: '/hubs',         label: 'Hubs',              icon: MapPin     },
      { href: '/retours',      label: 'Retours & NO_SHOW', icon: XCircle    },
      { href: '/score-ia',     label: 'Score IA',          icon: Brain      },
    ],
  },
  {
    key: 'operations', label: 'Opérations',
    items: [
      { href: '/dispatch', label: 'Dispatch',          icon: Truck          },
      { href: '/shifts',   label: 'Shifts & Planning', icon: Calendar       },
      { href: '/alertes',  label: 'Alertes & Tickets', icon: Bell           },
      { href: '/rapports', label: 'Rapports',           icon: Mail           },
      { href: '/support',  label: 'Support Client',     icon: HeadphonesIcon },
    ],
  },
  {
    key: 'rh', label: 'RH & Formation',
    items: [
      { href: '/pointage',   label: 'Pointage',   icon: Clock         },
      { href: '/onboarding', label: 'Onboarding', icon: UserCheck     },
      { href: '/academy',    label: 'Academy',    icon: GraduationCap },
    ],
  },
  {
    key: 'admin', label: 'Administration',
    items: [
      { href: '/admin', label: 'Super Admin', icon: Shield },
    ],
  },
]

// ── Tablet slide-in Sidebar ─────────────────────────────────────────────────────
function TabletSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const { user }  = useCurrentUser()
  const allowedRoutes = getAllowedRoutes(user?.role ?? 'VIEWER')
  const visibleSections = SECTIONS
    .map(s => ({ ...s, items: s.items.filter(i => allowedRoutes.includes(i.href)) }))
    .filter(s => s.items.length > 0)

  return (
    <>
      {/* Backdrop */}
      <div
        className={[
          'lg:hidden fixed inset-0 z-[45] transition-opacity duration-200',
          open ? 'bg-black/40 pointer-events-auto' : 'bg-transparent pointer-events-none opacity-0',
        ].join(' ')}
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className={[
          'lg:hidden fixed left-0 top-0 bottom-0 z-[46] w-[280px]',
          'bg-white border-r border-gray-200 flex flex-col shadow-2xl',
          'transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 relative flex-shrink-0">
              <Image src="/logo.png" alt="Shipinfy" width={32} height={32} className="object-contain" />
            </div>
            <div>
              <p className="text-[13px] font-black text-blue-700 leading-none">SHIPINFY</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Metrics & Analytics</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 space-y-0.5">
          {visibleSections.map(section => (
            <div key={section.key}>
              <div className="px-4 pt-3 pb-1">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">
                  {section.label}
                </span>
              </div>
              {section.items.map(item => {
                const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={[
                      'flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors active:scale-[0.98] duration-100',
                      isActive ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100',
                    ].join(' ')}
                  >
                    <item.icon size={16} className="flex-shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {isActive && <ChevronRight size={14} className="opacity-60" />}
                  </Link>
                )
              })}
            </div>
          ))}

          {/* Paramètres */}
          {allowedRoutes.includes('/parametres') && <>
          <div className="mx-3 my-1 h-px bg-gray-100" />
          <Link
            href="/parametres"
            onClick={onClose}
            className={[
              'flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname === '/parametres' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100',
            ].join(' ')}
          >
            <Settings size={16} />
            <span>Paramètres</span>
          </Link>
          </>}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-gray-100">
          <div className="px-3 py-2 bg-blue-50 rounded-xl">
            <p className="text-[11px] font-black text-blue-700">SHIPINFY v5.0</p>
            <p className="text-[10px] text-blue-400 mt-0.5">Sprint 12 — Mobile Responsive</p>
          </div>
        </div>
      </aside>
    </>
  )
}

// ── AppShell ────────────────────────────────────────────────────────────────────
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [tabletMenuOpen, setTabletMenuOpen] = useState(false)

  return (
    <>
      {/* Mobile/Tablet header (hidden on desktop) */}
      <MobileHeader onMenuClick={() => setTabletMenuOpen(true)} />

      {/* Tablet sidebar overlay (hidden on desktop) */}
      <TabletSidebar open={tabletMenuOpen} onClose={() => setTabletMenuOpen(false)} />

      {/* Page content */}
      {children}

      {/* Mobile bottom nav (hidden on desktop) */}
      <BottomNav />
    </>
  )
}
