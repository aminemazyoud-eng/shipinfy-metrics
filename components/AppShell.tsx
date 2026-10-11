'use client'
import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { X, ChevronRight } from 'lucide-react'
import MobileHeader from '@/components/MobileHeader'
import BottomNav from '@/components/BottomNav'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { getActiveNav, visibleModules } from '@/lib/module-nav'

// ── Tablet slide-in Sidebar (7 modules, même source que Sidebar.tsx) ───────────
function TabletSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const { user } = useCurrentUser()
  const modules = visibleModules(user?.role ?? 'VIEWER')
  const activeKey = getActiveNav(pathname)?.module.key

  return (
    <>
      <div
        className={[
          'lg:hidden fixed inset-0 z-[45] transition-opacity duration-200',
          open ? 'bg-black/40 pointer-events-auto' : 'bg-transparent pointer-events-none opacity-0',
        ].join(' ')}
        onClick={onClose}
      />

      <aside
        className={[
          'lg:hidden fixed left-0 top-0 bottom-0 z-[46] w-[280px]',
          'bg-white border-r border-gray-200 flex flex-col shadow-2xl',
          'transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 relative flex-shrink-0">
              <Image src="/logo.png" alt="Shipinfy" width={32} height={32} className="object-contain" />
            </div>
            <div>
              <p className="text-[13px] font-black text-blue-700 leading-none">SHIPINFY</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Opérationnel</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 space-y-0.5">
          {modules.map(m => {
            const isActive = activeKey === m.key
            return (
              <Link
                key={m.key}
                href={m.entry}
                onClick={onClose}
                className={[
                  'flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors active:scale-[0.98] duration-100',
                  isActive ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100',
                ].join(' ')}
              >
                <m.icon size={16} className="flex-shrink-0" />
                <span className="flex-1 truncate">{m.label}</span>
                {isActive && <ChevronRight size={14} className="opacity-60" />}
              </Link>
            )
          })}
        </nav>
      </aside>
    </>
  )
}

// ── AppShell ────────────────────────────────────────────────────────────────────
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [tabletMenuOpen, setTabletMenuOpen] = useState(false)

  return (
    <>
      <MobileHeader onMenuClick={() => setTabletMenuOpen(true)} />
      <TabletSidebar open={tabletMenuOpen} onClose={() => setTabletMenuOpen(false)} />
      {children}
      <BottomNav />
    </>
  )
}
