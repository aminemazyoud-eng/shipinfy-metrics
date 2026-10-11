'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { getActiveNav, visibleTabs } from '@/lib/module-nav'

export default function ModuleTabs() {
  const pathname = usePathname()
  const { user } = useCurrentUser()
  const active = getActiveNav(pathname)
  if (!active) return null
  // Paramétrage : navigation latérale gérée par app/parametres/layout.tsx
  if (active.module.key === 'parametres') return null

  const tabs = visibleTabs(active.module, user?.role ?? 'VIEWER')
  if (tabs.length < 2) return null

  return (
    <nav
      aria-label={active.module.label}
      className="flex gap-1 overflow-x-auto border-b border-gray-200 bg-white px-3 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map(t => {
        const isActive = t.href === active.tab.href
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={isActive ? 'page' : undefined}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px ${isActive ? 'border-purple-600 text-purple-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
