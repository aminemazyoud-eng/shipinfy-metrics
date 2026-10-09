/**
 * lib/ops-tracking.ts — suivi client par lien signé (Sprint 19, reco 4).
 * Jeton public = base64url(orderId).exp.signature — AUCUNE donnée personnelle dedans (l'id commande est un cuid opaque).
 * HMAC-SHA256 sur `trk|orderId|exp` avec PLANNING_LINK_SECRET (préfixe de domaine distinct de celui du planning).
 * Expiration = fin du créneau + 48 h. Le module reste PUR (pas d'import prisma au chargement) pour être testable.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { requireEnv } from '@/lib/env'
import { appUrl } from '@/lib/ops-planning'
import { buildSteps } from '@/lib/ops-steps'

const secret = () => requireEnv('PLANNING_LINK_SECRET')
export const TRACK_TTL_MS = 48 * 3_600_000

export const trackExpiry = (slotEnd: Date | number | string): number => new Date(slotEnd).getTime() + TRACK_TTL_MS
export const signTrack = (orderId: string, exp: number): string =>
  createHmac('sha256', secret()).update(`trk|${orderId}|${exp}`).digest('hex').slice(0, 32)

export function verifyTrack(orderId: string, exp: number, sig: string): boolean {
  if (!orderId || !Number.isFinite(exp) || Date.now() > exp) return false // lien expiré
  const a = Buffer.from(signTrack(orderId, exp)), b = Buffer.from(sig || '')
  return a.length === b.length && timingSafeEqual(a, b)
}

export const makeTrackToken = (orderId: string, exp: number): string =>
  `${Buffer.from(orderId, 'utf8').toString('base64url')}.${exp}.${signTrack(orderId, exp)}`

/** Décode ET vérifie le jeton ; renvoie l'id de commande, ou null (forme invalide, signature fausse, expiré). */
export function readTrackToken(token: string): string | null {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || token.length > 300) return null
  let orderId = ''
  try { orderId = Buffer.from(parts[0], 'base64url').toString('utf8') } catch { return null }
  const exp = Number(parts[1])
  if (!/^[\w-]{1,64}$/.test(orderId) || !/^\d{10,16}$/.test(parts[1])) return null
  return verifyTrack(orderId, exp, parts[2]) ? orderId : null
}

export const trackUrl = (orderId: string, slotEnd: Date | number | string): string =>
  `${appUrl()}/suivi/${makeTrackToken(orderId, trackExpiry(slotEnd))}`

// ─── Vue publique (DTO minimal) ───────────────────────────────────────────────────────────────────
export const STATUS_LABEL: Record<string, string> = {
  READY_PICKUP: 'Reçue', ASSIGNED: 'Assignée', IN_TRANSPORT: 'En route', START_DELIVERY: 'En livraison',
  DELIVERED: 'Livrée', NO_SHOW: 'Non livrée', CANCELLED: 'Annulée',
}
const STEP_LABEL: Record<string, string> = { RECEIVED: 'Reçue', ASSIGNED: 'Assignée', IN_TRANSPORT: 'En route', START_DELIVERY: 'En livraison', DELIVERED: 'Livrée', NO_SHOW: 'Non livrée' }
export const OTP_STATUSES = ['IN_TRANSPORT', 'START_DELIVERY']

export interface TrackOrderInput {
  reference: string | null; externalId: string; status: string; slotStart: Date; slotEnd: Date; slotLabel: string | null
  createdAtSrc: Date | null; deliveredAt: Date | null; noShowAt: Date | null
  events: { toStatus: string; at: Date; source?: string | null }[]
  hubName: string | null; driverFirstName: string | null; rating: number | null
}
export interface PublicTrackView {
  ref: string; status: string; statusLabel: string; slot: string | null; slotDay: string; slotEnd: string
  steps: { key: string; label: string; at: string }[]
  hub: string | null; driverFirstName: string | null; etaAt: string | null; deliveryCode: string | null
  delivered: boolean; closed: boolean; rating: number | null
}

const firstName = (s: string | null) => (s ? s.trim().split(/\s+/)[0].slice(0, 30) || null : null)

/** Construit la vue publique : jamais d'adresse, de téléphone, de montant ni de nom complet. */
export function toPublicView(o: TrackOrderInput, ctx: { etaAt?: string | null; otpCode?: string | null } = {}): PublicTrackView {
  const { steps } = buildSteps({
    createdAt: o.createdAtSrc, events: o.events.map(e => ({ to: e.toStatus, at: e.at, inferred: e.source === 'inferred' })),
    deliveredAt: o.deliveredAt, noShowAt: o.noShowAt, collectedAt: null, slotEnd: o.slotEnd,
  })
  const live = OTP_STATUSES.includes(o.status)
  return {
    ref: o.reference || o.externalId,
    status: o.status, statusLabel: STATUS_LABEL[o.status] ?? 'En cours',
    slot: o.slotLabel ? `${o.slotLabel.slice(0, 2)}h – ${o.slotLabel.slice(3)}h` : null,
    slotDay: o.slotStart.toISOString(), slotEnd: o.slotEnd.toISOString(),
    steps: steps.filter(s => s.at && STEP_LABEL[s.key]).map(s => ({ key: s.key, label: STEP_LABEL[s.key], at: s.at as string })),
    hub: o.hubName, driverFirstName: firstName(o.driverFirstName),
    etaAt: live ? ctx.etaAt ?? null : null,
    deliveryCode: live ? ctx.otpCode ?? null : null, // code de remise visible uniquement pendant le transport / la livraison
    delivered: o.status === 'DELIVERED', closed: ['DELIVERED', 'NO_SHOW', 'CANCELLED'].includes(o.status),
    rating: o.rating,
  }
}

/** Nettoie un commentaire client : pas de HTML, pas de caractères de contrôle, 300 caractères max. */
export function cleanComment(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(/<[^>]*>/g, ' ').replace(/[<>]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
  return t || null
}
