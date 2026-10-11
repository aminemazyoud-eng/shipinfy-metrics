import { redirect } from 'next/navigation'

// Fusionné dans « Recrutement » (/rh/onboarding, onglet Recrutement > Dossiers KYC). Ancienne adresse conservée.
export default function Page() { redirect('/rh/onboarding?tab=recrutement&view=kyc') }
