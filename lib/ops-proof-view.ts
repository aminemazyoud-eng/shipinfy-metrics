/**
 * lib/ops-proof-view.ts — fonctions PURES du côté bureau pour les preuves de livraison (Sprint 20) :
 * type MIME autorisé, badge de géolocalisation. Aucun import (testable sans base).
 */

/** Types d'image acceptés/servis pour une preuve. */
export const PROOF_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** Renvoie le type MIME normalisé s'il est autorisé, sinon null (jamais de SVG/HTML servi depuis la base). */
export function allowedProofMime(mime: unknown): (typeof PROOF_MIMES)[number] | null {
  if (typeof mime !== 'string') return null
  const m = mime.split(';')[0].trim().toLowerCase()
  return (PROOF_MIMES as readonly string[]).includes(m) ? (m as (typeof PROOF_MIMES)[number]) : null
}

export interface GeoBadge { tone: 'green' | 'orange' | 'gray'; label: string }

/**
 * Libellé + couleur du bloc géolocalisation d'une livraison.
 * - pas de distance (position absente) → gris ;
 * - distance ≤ seuil (ou ok === true) → vert ; sinon orange.
 * Si `ok` est fourni il fait foi (calculé côté serveur avec le seuil en vigueur à l'époque), sinon on compare au seuil.
 */
export function geoBadge(distanceM: number | null | undefined, ok: boolean | null | undefined, thresholdM: number): GeoBadge {
  if (distanceM == null || !Number.isFinite(distanceM)) return { tone: 'gray', label: 'Position non enregistrée' }
  const d = Math.round(distanceM)
  const good = ok == null ? d <= thresholdM : ok
  const txt = d >= 1000 ? `${(d / 1000).toFixed(1).replace('.', ',')} km` : `${d} m`
  return { tone: good ? 'green' : 'orange', label: `Livré à ${txt} de l'adresse` }
}
