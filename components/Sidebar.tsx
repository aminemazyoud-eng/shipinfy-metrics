'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { getActiveNav, visibleModules } from '@/lib/module-nav'

// ─── Floating tooltip (collapsed mode) ────────────────────────────────────────
function Tooltip({ label }: { label: string }) {
  return (
    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-[300] pointer-events-none">
      <div className="bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap leading-none">
        {label}
      </div>
      <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[5px] border-r-gray-900" />
    </div>
  )
}

// ─── Main Sidebar (7 modules) ──────────────────────────────────────────────────
export default function Sidebar() {
  const pathname = usePathname()
  const { user } = useCurrentUser()
  const modules = visibleModules(user?.role ?? 'VIEWER')
  const activeKey = getActiveNav(pathname)?.module.key

  const [expanded, setExpanded] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hoveredItem, setHovered] = useState<string | null>(null)

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
        'fixed left-0 top-0 bottom-0 z-50',
        'flex flex-col bg-white border-r border-gray-200',
        'transition-[width] duration-200 ease-in-out overflow-hidden',
        expanded ? 'w-60 shadow-2xl' : 'w-[60px]',
      ].join(' ')}
    >
      {/* Brand */}
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
            <p className="text-[10px] text-gray-400 mt-0.5 leading-none truncate">Opérationnel</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-0.5">
        {modules.map(m => {
          const isActive = activeKey === m.key
          return (
            <div key={m.key} className="relative">
              {!expanded && hoveredItem === m.key && <Tooltip label={m.label} />}
              <Link
                href={m.entry}
                onMouseEnter={() => { if (!expanded) setHovered(m.key) }}
                onMouseLeave={() => { if (!expanded) setHovered(null) }}
                className={[
                  'flex items-center transition-colors duration-100 select-none',
                  expanded
                    ? 'gap-2.5 mx-2 px-2.5 py-2 rounded-lg text-sm font-medium'
                    : 'justify-center w-9 h-9 rounded-lg mx-auto my-0.5',
                  isActive ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                ].join(' ')}
              >
                <m.icon size={16} className="flex-shrink-0" />
                {expanded && <span className="flex-1 truncate">{m.label}</span>}
              </Link>
            </div>
          )
        })}
      </nav>

      {expanded && (
        <div className="flex-shrink-0 p-2.5 border-t border-gray-100">
          <div className="px-3 py-2 bg-blue-50 rounded-xl">
            <p className="text-[11px] font-black text-blue-700 leading-none">SHIPINFY</p>
            <p className="text-[10px] text-blue-400 mt-1 leading-none">Opérationnel</p>
          </div>
        </div>
      )}
    </aside>
  )
}
