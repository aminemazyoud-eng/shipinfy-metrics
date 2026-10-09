'use client'
/**
 * lib/use-polling.ts — rafraîchissement périodique côté client (Sprint 17 C4).
 *   usePolling(load, 30_000)
 * - saute un tick si l'onglet est masqué (et rattrape dès qu'il redevient visible, si le délai est écoulé) ;
 * - jamais deux appels en parallèle : si la requête précédente n'est pas terminée, le tick est ignoré ;
 * - nettoyage propre au démontage ; `fn` peut changer à chaque rendu sans relancer le minuteur.
 * Ne déclenche PAS d'appel immédiat : la page garde son propre useEffect(() => { load() }, [load]).
 */
import { useEffect, useRef } from 'react'

export function usePolling(fn: () => unknown | Promise<unknown>, ms: number, enabled = true) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn }, [fn])
  useEffect(() => {
    if (!enabled || !(ms > 0)) return
    let running = false, last = Date.now(), alive = true
    const tick = async () => {
      if (!alive || running || document.visibilityState !== 'visible') return
      running = true
      try { await ref.current() } catch { /* l'appelant gère ses erreurs */ } finally { running = false; last = Date.now() }
    }
    const id = setInterval(tick, ms)
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - last >= ms) tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [ms, enabled])
}
