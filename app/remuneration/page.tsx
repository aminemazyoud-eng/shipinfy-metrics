import { redirect } from 'next/navigation'

// Fusionné dans « Paie » (onglet Calcul > À la course, données temps réel). Ancienne adresse conservée.
export default function Page() { redirect('/rh/paie?tab=calcul&mode=course') }
