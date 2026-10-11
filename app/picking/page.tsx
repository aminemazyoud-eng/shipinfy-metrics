import { redirect } from 'next/navigation'

// Fusionné dans « Vagues » (onglet Préparation / picking). Ancienne adresse conservée.
export default function Page() { redirect('/operations/vagues?tab=prep') }
