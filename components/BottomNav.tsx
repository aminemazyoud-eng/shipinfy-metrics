'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity, BarChart3, Bell, Users, MoreHorizontal,
  MapPin, XCircle, GraduationCap, Brain,
  FileText, UserCheck, Settings, TrendingUp, X, DollarSign,
  Truck, Clock, HeadphonesIcon, Shield,
} from 'lucide-react'

const MAIN_ITEMS = [
  { href: '/',        label: 'Dashboard', icon: Activity  },
  { href: '/kpis',    label: 'KPIs',      icon: BarChart3 },
  { href: '/alertes', label: 'Alertes',   icon: Bell      },
  { href: '/livreurs',label: 'Livreurs',  icon: Users     },
]

const MORE_ITEMS = [
  { href: '/previsions',   label: 'Prévisions',       icon: TrendingUp    },
  { href: '/dispatch',     label: 'Dispatch',          icon: Truck         },
  { href: '/pointage',     label: 'Pointage',          icon: Clock         },
  { href: '/support',      label: 'Support',           icon: HeadphonesIcon},
  { href: '/remuneration', label: 'Rémunération',     icon: DollarSign    },
  { href: '/hubs',         label: 'Hubs',              icon: MapPin        },
  { href: '/retours',      label: 'Retours & NO_SHOW', icon: XCircle       },
  { href: '/score-ia',     label: 'Score IA',          icon: Brain         },
  { href: '/rapports',     label: 'Rapports',           icon: FileText      },
  { href: '/onboarding',   label: 'Onboarding',         icon: UserCheck     },
  { href: '/academy',      label: 'Academy',            icon: GraduationCap },
  { href: '/admin',        label: 'Super Admin',        icon: Shield        },
  { href: '/parametres',   label: 'Paramètres',         icon: Settings      },
]

export default function BottomNav() {
  const pathname  = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Bottom nav bar */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex items-center"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', height: 'calc(60px + env(safe-area-inset-bottom))' }}
      >
        {MAIN_ITEMS.map(item => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[60px]',
                'active:scale-95 transition-transform duration-100',
                isActive ? 'text-blue-600' : 'text-gray-400',
              ].join(' ')}
            >
              <item.icon size={20} />
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </Link>
          )
        })}

        {/* Plus button */}
        <button
          onClick={() => setOpen(true)}
          className={[
            'flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[60px]',
            'active:scale-95 transition-transform duration-100',
            open ? 'text-blue-600' : 'text-gray-400',
          ].join(' ')}
        >
          <MoreHorizontal size={20} />
          <span className="text-[10px] font-medium leading-none">Plus</span>
        </button>
      </nav>

      {/* "Plus" slide-up drawer */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="lg:hidden fixed inset-0 z-[55] bg-black/50"
            onClick={() => setOpen(false)}
          />
          {/* Drawer */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[60] bg-white rounded-t-2xl shadow-2xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3 border-b border-gray-100">
              <span className="text-sm font-bold text-gray-800">Tous les modules</span>
              <button onClick={() => setOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100">
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            {/* Items grid */}
            <div className="grid grid-cols-4 gap-1 p-3 max-h-[60vh] overflow-y-auto">
              {MORE_ITEMS.map(item => {
                const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={[
                      'flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl',
                      'active:scale-95 transition-transform duration-100',
                      isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50',
                    ].join(' ')}
                  >
                    <item.icon size={22} />
                    <span className="text-[10px] font-medium text-center leading-tight">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}
