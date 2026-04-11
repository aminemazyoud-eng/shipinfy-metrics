import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import AppShell from '@/components/AppShell'
import { Toaster } from '@/components/ui/sonner'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'SHIPINFY Metrics',
  description: 'Analytics & KPIs — Livraisons',
  icons: { icon: '/logo.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={inter.className}>
        <div className="min-h-screen bg-gray-50">
          {/* Desktop sidebar — hidden on mobile/tablet */}
          <div className="hidden lg:block">
            <Sidebar />
          </div>
          {/* ml-[60px] desktop only — mobile/tablet: no left margin, add bottom padding for bottom nav */}
          <main className="lg:ml-[60px] min-h-screen overflow-auto pb-[76px] lg:pb-0">
            <AppShell>
              {children}
            </AppShell>
          </main>
        </div>
        <Toaster />
      </body>
    </html>
  )
}
