'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, BarChart3 } from 'lucide-react'

const navItems = [
  { href: '/', label: 'Dashboard Temps Réel', icon: Activity },
  { href: '/kpis', label: 'KPIs & Métriques', icon: BarChart3 },
]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-blue-600">SHIPINFY</h1>
        <p className="text-xs text-gray-500 mt-1">Metrics & Analytics</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
