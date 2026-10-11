import { redirect } from 'next/navigation'

// Fusionné dans « Pointage » (onglet Aujourd'hui). Le bloc paie est dans /rh/paie.
export default function Page() { redirect('/rh/pointage?tab=today') }
