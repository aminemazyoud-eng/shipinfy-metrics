import { redirect } from 'next/navigation'

// Les intégrations (API, webhooks, capteurs) sont dans Paramétrage → Intégrations.
export default function Page() { redirect('/parametres/integrations') }
