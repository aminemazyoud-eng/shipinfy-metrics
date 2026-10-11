import { redirect } from 'next/navigation'

// Fusionné dans « Incidents » (onglet Notifications). Ancienne adresse conservée.
export default function Page() { redirect('/incidents?tab=notifications') }
