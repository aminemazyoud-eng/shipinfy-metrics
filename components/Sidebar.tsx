'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import type { LucideProps } from 'lucide-react'
import {
  Activity, BarChart3, Users, MapPin, XCircle,
  TrendingUp, Bell, Mail, Settings,
  UserCheck, GraduationCap, ChevronRight, Brain,
} from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface NavItem {
  href:      string
  label:     string
  icon:      React.ComponentType<LucideProps>
  disabled?: boolean
}
interface NavSection {
  key:   string
  label: string
  items: NavItem[]
}

// ─── Nav structure ─────────────────────────────────────────────────────────────
const SECTIONS: NavSection[] = [
  {
    key: 'analytics',
    label: 'Analytics',
    items: [
      { href: '/',     label: 'Dashboard',        icon: Activity  },
      { href: '/kpis', label: 'KPIs & Métriques', icon: BarChart3 },
    ],
  },
  {
    key: 'performance',
    label: 'Performance',
    items: [
      { href: '/livreurs',   label: 'Livreurs',          icon: Users,      disabled: false },
      { href: '/hubs',       label: 'Hubs',               icon: MapPin,     disabled: false },
      { href: '/retours',    label: 'Retours & NO_SHOW',  icon: XCircle,    disabled: false },
      { href: '/previsions', label: 'Prévisions',         icon: TrendingUp, disabled: true  },
      { href: '/score-ia',  label: 'Score IA',           icon: Brain,      disabled: false },
    ],
  },
  {
    key: 'operations',
    label: 'Opérations',
    items: [
      { href: '/alertes',  label: 'Alertes & Tickets', icon: Bell, disabled: false },
      { href: '/rapports', label: 'Rapports',           icon: Mail, disabled: false },
    ],
  },
  {
    key: 'rh',
    label: 'RH & Formation',
    items: [
      { href: '/onboarding', label: 'Onboarding', icon: UserCheck,     disabled: false },
      { href: '/academy',    label: 'Academy',    icon: GraduationCap, disabled: false },
    ],
  },
]

// ─── Floating tooltip (collapsed mode) ────────────────────────────────────────
function Tooltip({ label }: { label: string }) {
  return (
    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-[300] pointer-events-none">
      <div className="bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap leading-none">
        {label}
      </div>
      {/* Arrow */}
      <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[5px] border-r-gray-900" />
    </div>
  )
}

// ─── Main Sidebar ──────────────────────────────────────────────────────────────
export default function Sidebar() {
  const pathname = usePathname()

  const [expanded, setExpanded]   = useState(false)
  const leaveTimer                = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hoveredItem, setHovered] = useState<string | null>(null)

  // Accordion state per section, persisted in localStorage
  const [accordion, setAccordion] = useState<Record<string, boolean>>({
    analytics: true, performance: true, operations: true, rh: true,
  })

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sb_accordion')
      if (saved) setAccordion(JSON.parse(saved))
    } catch {}
  }, [])

  const toggleAccordion = (key: string) => {
    setAccordion(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem('sb_accordion', JSON.stringify(next)) } catch {}
      return next
    })
  }

  const onEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    setExpanded(true)
  }
  const onLeave = () => {
    leaveTimer.current = setTimeout(() => {
      setExpanded(false)
      setHovered(null)
    }, 80)
  }

  return (
    <aside
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={[
        // Fixed overlay — content never shifts
        'fixed left-0 top-0 bottom-0 z-50',
        'flex flex-col bg-white border-r border-gray-200',
        'transition-[width] duration-200 ease-in-out overflow-hidden',
        expanded ? 'w-60 shadow-2xl' : 'w-[60px]',
      ].join(' ')}
    >

      {/* ── Brand ─────────────────────────────────────────────────────────── */}
      <div className={[
        'flex items-center border-b border-gray-100 flex-shrink-0',
        expanded ? 'px-3.5 py-3.5 gap-2.5' : 'justify-center py-3.5',
      ].join(' ')}>
        <div className="w-8 h-8 flex-shrink-0 relative">
          <Image src="/logo.png" alt="Shipinfy" width={32} height={32} className="object-contain" priority />
        </div>
        {expanded && (
          <div className="min-w-0">
            <p className="text-[13.5px] font-black text-blue-700 leading-none tracking-tight truncate">SHIPINFY</p>
            <p className="text-[10px] text-gray-400 mt-0.5 leading-none truncate">Metrics & Analytics</p>
          </div>
        )}
      </div>

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-0.5">
        {SECTIONS.map(section => (
          <div key={section.key}>

            {/* Section header */}
            {expanded ? (
              <button
                onClick={() => toggleAccordion(section.key)}
                className="w-full flex items-center justify-between px-3.5 pt-2.5 pb-1 hover:opacity-80 transition-opacity"
              >
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em] leading-none">
                  {section.label}
                </span>
                <ChevronRight
                  size={11}
                  className={[
                    'text-gray-300 transition-transform duration-150 flex-shrink-0',
                    accordion[section.key] ? 'rotate-90' : '',
                  ].join(' ')}
                />
              </button>
            ) : (
              <div className="mx-3 my-0.5 h-px bg-gray-100" />
            )}

            {/* Items — respect accordion in expanded mode, always show in collapsed */}
            <div className={expanded && !accordion[section.key] ? 'hidden' : ''}>
              {section.items.map(item => {
                const isActive   = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
                const isDisabled = item.disabled === true
                const tooltipKey = item.href

                return (
                  <div key={item.href} className="relative">
                    {/* Tooltip — collapsed only */}
                    {!expanded && hoveredItem === tooltipKey && !isDisabled && (
                      <Tooltip label={item.label} />
                    )}

                    <Link
                      href={isDisabled ? '#' : item.href}
                      onClick={e => isDisabled && e.preventDefault()}
                      onMouseEnter={() => { if (!expanded) setHovered(tooltipKey) }}
                      onMouseLeave={() => { if (!expanded) setHovered(null) }}
                      className={[
                        'flex items-center transition-colors duration-100 select-none',
                        expanded
                          ? 'gap-2.5 mx-2 px-2.5 py-2 rounded-lg text-sm font-medium'
                          : 'justify-center w-9 h-9 rounded-lg mx-auto my-0.5',
                        isActive
                          ? 'bg-blue-600 text-white'
                          : isDisabled
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                      ].join(' ')}
                    >
                      <item.icon size={15} className="flex-shrink-0" />
                      {expanded && (
                        <>
                          <span className="flex-1 truncate">{item.label}</span>
                          {isDisabled && (
                            <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-semibold flex-shrink-0">
                              Soon
                            </span>
                          )}
                        </>
                      )}
                    </Link>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* ── Separator + Paramètres ────────────────────────────────────── */}
        <div className={expanded ? 'mx-3 my-1 h-px bg-gray-100' : 'mx-3 my-0.5 h-px bg-gray-100'} />

        <div className="relative">
          {!expanded && hoveredItem === '__settings' && <Tooltip label="Paramètres" />}
          <Link
            href="/parametres"
            onMouseEnter={() => { if (!expanded) setHovered('__settings') }}
            onMouseLeave={() => { if (!expanded) setHovered(null) }}
            className={[
              'flex items-center transition-colors duration-100',
              expanded
                ? 'gap-2.5 mx-2 px-2.5 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100'
                : 'justify-center w-9 h-9 rounded-lg mx-auto text-gray-400 hover:bg-gray-100',
            ].join(' ')}
          >
            <Settings size={15} className="flex-shrink-0" />
            {expanded && <span>Paramètres</span>}
          </Link>
        </div>
      </nav>

      {/* ── Footer (expanded only) ────────────────────────────────────────── */}
      {expanded && (
        <div className="flex-shrink-0 p-2.5 border-t border-gray-100">
          <div className="px-3 py-2 bg-blue-50 rounded-xl">
            <p className="text-[11px] font-black text-blue-700 leading-none">SHIPINFY v3.1</p>
            <p className="text-[10px] text-blue-400 mt-1 leading-none">Sprint 6 — Academy + Guides</p>
          </div>
        </div>
      )}
    </aside>
  )
}
