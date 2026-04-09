/**
 * instrumentation.ts — Point d'entrée serveur Next.js
 *
 * Exécuté une seule fois au démarrage du serveur (Node.js runtime uniquement).
 * Lance le scheduler node-cron pour les envois de rapports planifiés.
 *
 * Doc: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Exécuter uniquement côté Node.js (pas Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCronScheduler } = await import('./lib/cron')
    startCronScheduler()
  }
}
