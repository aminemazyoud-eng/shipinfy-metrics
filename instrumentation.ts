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

    // Sprint 16 BLOC 1 — vérification SMTP non-bloquante
    import('./lib/email')
      .then(m => m.verifySmtpConnection())
      .then(r => {
        if (!r.ok) console.warn('[instrumentation] Email non fonctionnel:', r.provider, r.error)
        else console.log('[instrumentation] Email OK:', r.provider)
      })
      .catch(() => {})
  }
}
