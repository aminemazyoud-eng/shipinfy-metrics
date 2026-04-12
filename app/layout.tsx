import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import AppLayoutShell from './AppLayoutShell'
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
        <AppLayoutShell>
          {children}
        </AppLayoutShell>
        <Toaster />
      </body>
    </html>
  )
}
