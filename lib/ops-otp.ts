/**
 * lib/ops-otp.ts — code de remise à 4 chiffres (Sprint 19, reco 5 de l'audit).
 * Le code est DÉRIVÉ (HMAC-SHA256 du secret serveur + identifiant de commande) : rien à stocker, stable pour une commande.
 * Il n'est affiché QUE sur la page de suivi du client ; le livreur le demande au client à la remise et le saisit côté Ops.
 * Aucune route Ops ne renvoie jamais le code. Fonctions pures (aucun accès base).
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { requireEnv } from '@/lib/env'

/** Nombre maximal d'essais ratés avant verrouillage de la vérification d'une commande. */
export const OTP_MAX_ATTEMPTS = 5

/** Code à 4 chiffres (« 0042 » possible) : 4 premiers octets du HMAC lus en entier non signé, modulo 10 000. */
export function otpCodeFor(orderId: string): string {
  const mac = createHmac('sha256', requireEnv('PLANNING_LINK_SECRET')).update('otp|' + orderId).digest()
  return String(mac.readUInt32BE(0) % 10_000).padStart(4, '0')
}

/** Vérifie un code saisi : format strict (4 chiffres) puis comparaison à temps constant. */
export function verifyOtp(orderId: string, code: string): boolean {
  if (typeof code !== 'string' || !/^\d{4}$/.test(code)) return false
  const a = Buffer.from(otpCodeFor(orderId)), b = Buffer.from(code)
  return a.length === b.length && timingSafeEqual(a, b)
}
