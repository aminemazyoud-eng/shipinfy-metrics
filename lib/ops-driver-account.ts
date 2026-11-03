/**
 * lib/ops-driver-account.ts — compte de l'application livreur (identifiant + mot de passe).
 * Les comptes livreur sont SÉPARÉS des utilisateurs du back-office (table User) : un livreur ne reçoit jamais de session bureau,
 * il obtient seulement le jeton de l'application livreur (x-driver-token), limité aux routes /api/driver/*.
 * Fonctions pures (testables sans base).
 */
import { randomInt } from 'crypto'

export const DRIVER_PW_MIN = 6
export const DRIVER_PW_MAX = 72
// alphabet sans caractères ambigus (0/O, 1/l/I) : le mot de passe est dicté ou tapé sur un petit clavier
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateDriverPassword(len = 8): string {
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return s
}

/** Identifiant saisi : code livreur (majuscules, sans espace) ou téléphone (chiffres, +). */
export function normalizeLogin(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, '').slice(0, 40) : ''
}

export const validDriverPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= DRIVER_PW_MIN && p.length <= DRIVER_PW_MAX
