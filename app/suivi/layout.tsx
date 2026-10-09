import type { Metadata } from 'next'

// Page publique de suivi : jamais indexée
export const metadata: Metadata = { title: 'Suivi de livraison', robots: { index: false, follow: false } }

export default function SuiviLayout({ children }: { children: React.ReactNode }) { return <>{children}</> }
