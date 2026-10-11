import { redirect } from 'next/navigation'

// Fusionné dans « Commandes » (onglet Terminées).
export default function Page() { redirect('/operations/suivi?tab=done') }
