import { redirect } from 'next/navigation'

// Fusionné dans « Pointage » (onglet Scan QR / kiosque). Ancienne adresse conservée (QR, liens WhatsApp).
export default function Page() { redirect('/rh/pointage?tab=scan') }
