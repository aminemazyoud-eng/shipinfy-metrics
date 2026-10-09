import type { Metadata, Viewport } from 'next'

// Application livreur (PWA) : jamais indexée, manifeste dédié, mobile uniquement.
export const metadata: Metadata = {
  title: 'SHIPINFY Livreur',
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: false },
  icons: { icon: '/logo.png', apple: '/logo.png' },
  appleWebApp: { capable: true, title: 'Livreur', statusBarStyle: 'default' },
}
export const viewport: Viewport = {
  themeColor: '#1d4ed8',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function LivreurLayout({ children }: { children: React.ReactNode }) { return <>{children}</> }
