'use client'
import { usePathname } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import AppShell from '@/components/AppShell'

// Pages that render without Sidebar/AppShell
const AUTH_PATHS = ['/login']

export default function AppLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuthPage = AUTH_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))

  if (isAuthPage) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop sidebar — hidden on mobile/tablet */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>
      {/* ml-[60px] desktop only */}
      <main className="lg:ml-[60px] min-h-screen overflow-auto pb-[76px] lg:pb-0">
        <AppShell>
          {children}
        </AppShell>
      </main>
    </div>
  )
}
