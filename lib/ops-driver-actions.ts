/**
 * lib/ops-driver-actions.ts — actions de l'application livreur (Sprint 20) : machine à états stricte, preuves, géolocalisation, pointage.
 *
 * Deux parties :
 *  1. FONCTIONS PURES (nextStatus, clampClientTime, proofRequirementMet, parseActions, …) — testées sans base ;
 *  2. processDriverAction : traitement d'UNE action (idempotent par identifiant généré par le téléphone, UPDATE atomique conditionné).
 * Les modules qui touchent la base sont importés à la demande pour que la partie pure reste importable dans un script de test.
 */
import { verifyOtp, OTP_MAX_ATTEMPTS } from '@/lib/ops-otp'
import { geoCheck, validLatLng } from '@/lib/geo'
import { localDay } from '@/lib/tz'
import { CFG } from '@/lib/ops-config'

export const ACTION_TYPES = ['accept', 'start', 'deliver', 'noshow', 'checkin', 'checkout'] as const
export type ActionType = (typeof ACTION_TYPES)[number]
export type OrderActionType = 'accept' | 'start' | 'deliver' | 'noshow'
export const MAX_ACTIONS_PER_SYNC = 50
export const FUTURE_TOLERANCE_MS = 5 * 60_000
export const MAX_PROOFS_PER_ORDER = 5
export const PROOF_MAX_KB = 400
export const MIN_NOSHOW_REASON = 3

// ─── 1. FONCTIONS PURES ───────────────────────────────────────────────────────────────────────────

/** Statut requis AVANT chaque action et statut obtenu APRÈS (aucune étape sautée). */
export const FROM_STATUS: Record<OrderActionType, string> = { accept: 'ASSIGNED', start: 'IN_TRANSPORT', deliver: 'START_DELIVERY', noshow: 'START_DELIVERY' }
export const TO_STATUS: Record<OrderActionType, string> = { accept: 'IN_TRANSPORT', start: 'START_DELIVERY', deliver: 'DELIVERED', noshow: 'NO_SHOW' }

export const isOrderAction = (t: string): t is OrderActionType => t in FROM_STATUS

/** Statut résultant si l'action est permise depuis `current`, sinon null (transition interdite : rien ne doit être modifié). */
export function nextStatus(type: string, current: string): string | null {
  return isOrderAction(type) && FROM_STATUS[type] === current ? TO_STATUS[type] : null
}

type When = Date | string | number | null | undefined
const toMs = (v: When): number | null => {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/**
 * Horodatage client BORNÉ : jamais dans le futur de plus de 5 min, jamais antérieur au dernier événement de la commande.
 * Sinon on retient l'heure serveur (au moins égale au dernier événement pour garder une chronologie croissante).
 */
export function clampClientTime(at: When, now: When, lastEventAt?: When): Date {
  const nowMs = toMs(now) ?? Date.now()
  const last = toMs(lastEventAt)
  const fallback = new Date(last != null ? Math.max(nowMs, last) : nowMs)
  const t = toMs(at)
  if (t == null) return fallback
  if (t > nowMs + FUTURE_TOLERANCE_MS) return fallback
  if (last != null && t < last) return fallback
  return new Date(t)
}

/** Exigence de preuve pour livrer. 'otp_or_photo' = code valide OU au moins une photo. */
export function proofRequirementMet(mode: string, s: { otpValid: boolean; photoCount: number }): boolean {
  const photo = s.photoCount > 0
  switch (mode) {
    case 'otp': return s.otpValid
    case 'photo': return photo
    case 'otp_or_photo': return s.otpValid || photo
    default: return s.otpValid || photo // valeur inconnue : repli sur la règle par défaut
  }
}

/** Absence client : motif d'au moins 3 caractères ET au moins une photo. */
export function noShowRequirementMet(reason: unknown, photoCount: number): boolean {
  return typeof reason === 'string' && reason.trim().length >= MIN_NOSHOW_REASON && photoCount > 0
}

/** Nom du client réduit à « Prénom I. » (aucune donnée superflue côté livreur). */
export function shortName(full: string | null | undefined): string {
  const p = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return ''
  return p.length === 1 ? p[0] : `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`
}

export interface DriverActionIn {
  id: string; type: ActionType; orderId?: string; at?: string
  geo?: { lat: number; lng: number; accuracy?: number }
  otp?: string; reason?: string; proofClientIds?: string[]
}

/** Validation de forme d'une action reçue (renvoie l'action nettoyée ou la raison du rejet). */
export function parseAction(raw: unknown): { action: DriverActionIn } | { error: string } {
  const a = raw as Record<string, unknown> | null
  if (!a || typeof a !== 'object') return { error: 'action illisible' }
  if (typeof a.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(a.id)) return { error: 'identifiant d\'action invalide' }
  if (typeof a.type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(a.type)) return { error: 'type d\'action inconnu' }
  const type = a.type as ActionType
  if (isOrderAction(type) && (typeof a.orderId !== 'string' || !a.orderId || a.orderId.length > 64)) return { error: 'orderId requis' }
  const out: DriverActionIn = { id: a.id, type }
  if (typeof a.orderId === 'string') out.orderId = a.orderId
  if (typeof a.at === 'string') out.at = a.at.slice(0, 40)
  const g = a.geo as Record<string, unknown> | undefined
  if (g && validLatLng(g.lat, g.lng)) out.geo = { lat: g.lat as number, lng: g.lng as number, accuracy: typeof g.accuracy === 'number' && Number.isFinite(g.accuracy) ? g.accuracy : undefined }
  if (typeof a.otp === 'string') out.otp = a.otp.trim().slice(0, 8)
  if (typeof a.reason === 'string') out.reason = a.reason.trim().slice(0, 300)
  if (Array.isArray(a.proofClientIds)) out.proofClientIds = a.proofClientIds.filter((x): x is string => typeof x === 'string').slice(0, 10)
  return { action: out }
}

/** Seuils de l'application (lus dans CFG, défauts 300 m / 400 Ko / preuve code-ou-photo). */
export function driverAppConfig() {
  return {
    geofenceMeters: CFG.geofenceMeters ?? 300,
    deliveryGeofenceMeters: CFG.deliveryGeofenceMeters ?? 300,
    photoMaxKB: PROOF_MAX_KB,
    proofRequired: (CFG.proofRequired ?? 'otp_or_photo') as string,
    otpRequired: true,
  }
}

// ─── 2. TRAITEMENT D'UNE ACTION ───────────────────────────────────────────────────────────────────

export interface ActionResult {
  id: string; ok: boolean; code?: string; error?: string; message?: string
  order?: { id: string; status: string }
  attendance?: Record<string, unknown>
  attemptsLeft?: number; locked?: boolean; replayed?: boolean
}

// Échecs NON mémorisés : la même action (même identifiant) pourra être rejouée une fois la condition levée (photo arrivée, panne passée…).
const RETRYABLE = new Set(['PROOF_REQUIRED', 'SERVER_ERROR'])

const fail = (id: string, code: string, message: string, extra: Partial<ActionResult> = {}): ActionResult => ({ id, ok: false, code, error: code, message, ...extra })

interface DriverLite { id: string; code: string; firstName: string; lastName: string; tenantId: string | null; hub: { code: string; name: string; lat: number | null; lng: number | null } | null }

/**
 * Traite une action : idempotent (OpsDriverAction.id), machine à états stricte, jamais bloquant sur la géolocalisation.
 * Lève MissingEnvError si PLANNING_LINK_SECRET est absent (la route répond alors 503).
 */
export async function processDriverAction(driver: DriverLite, action: DriverActionIn, nowMs = Date.now()): Promise<ActionResult> {
  const { prisma } = await import('@/lib/prisma')
  const { applyOpsSettings } = await import('@/lib/ops-settings')
  await applyOpsSettings() // seuils (rayons, preuve exigée) à jour, cache 20 s
  const prev = await prisma.opsDriverAction.findUnique({ where: { id: action.id } })
  if (prev) {
    if (prev.driverCode !== driver.code) return fail(action.id, 'ID_CONFLICT', 'Identifiant d\'action déjà utilisé')
    try { return { ...(JSON.parse(prev.result ?? '{}') as ActionResult), id: action.id, replayed: true } } catch { return { id: action.id, ok: prev.ok, replayed: true } }
  }

  let res: ActionResult
  try {
    res = isOrderAction(action.type) ? await orderAction(driver, action, nowMs) : await attendanceAction(driver, action, nowMs)
  } catch (e) {
    const { MissingEnvError } = await import('@/lib/env')
    if (e instanceof MissingEnvError) throw e
    console.error('[driver-action]', action.type, e)
    return fail(action.id, 'SERVER_ERROR', 'Erreur serveur')
  }
  if (res.code && RETRYABLE.has(res.code)) return res

  // mémorisation (sans code OTP ni donnée superflue) ; en cas de course sur le même identifiant, le premier résultat fait foi
  try {
    await prisma.opsDriverAction.create({
      data: {
        id: action.id, driverCode: driver.code, orderId: action.orderId ?? null, type: action.type, ok: res.ok, result: JSON.stringify(res),
        clientAt: toMs(action.at) != null ? new Date(toMs(action.at)!) : null,
        payload: JSON.stringify({ geo: action.geo ?? null, reason: action.reason ?? null, proofs: action.proofClientIds?.length ?? 0 }),
      },
    })
  } catch {
    const first = await prisma.opsDriverAction.findUnique({ where: { id: action.id } }).catch(() => null)
    if (first && first.driverCode === driver.code) { try { return { ...(JSON.parse(first.result ?? '{}') as ActionResult), id: action.id, replayed: true } } catch { /* garde res */ } }
  }
  return res
}

async function orderAction(driver: DriverLite, action: DriverActionIn, nowMs: number): Promise<ActionResult> {
  const { prisma } = await import('@/lib/prisma')
  const { randomUUID } = await import('crypto')
  const type = action.type as OrderActionType
  const id = action.id
  const o = await prisma.opsOrder.findFirst({
    where: { id: action.orderId!, driverId: driver.id },
    select: { id: true, externalId: true, status: true, hubCode: true, lat: true, lng: true, otpVerifiedAt: true, otpAttempts: true },
  })
  if (!o) return fail(id, 'NOT_FOUND', 'Commande introuvable ou non assignée à ce livreur')
  const target = nextStatus(type, o.status)
  if (!target) return fail(id, 'BAD_STATE', `Transition impossible depuis ${o.status}`, { order: { id: o.id, status: o.status } })

  const last = await prisma.opsOrderEvent.findFirst({ where: { orderId: o.id }, orderBy: { at: 'desc' }, select: { at: true } })
  const at = clampClientTime(action.at, nowMs, last?.at)
  const driverName = `${driver.firstName} ${driver.lastName}`.trim()
  const cfg = driverAppConfig()
  let geo: ReturnType<typeof geoCheck> = null
  let proofs = 0

  if (type === 'deliver' || type === 'noshow') {
    proofs = await prisma.opsProof.count({ where: { orderId: o.id, driverCode: driver.code } })
    geo = geoCheck(action.geo, o, cfg.deliveryGeofenceMeters)
  }

  if (type === 'deliver') {
    // 1) code de remise (optionnel si une photo suffit) : essais comptés de façon atomique, verrou après OTP_MAX_ATTEMPTS
    let otpValid = o.otpVerifiedAt != null
    if (!otpValid && action.otp) {
      if (o.otpAttempts >= OTP_MAX_ATTEMPTS) return fail(id, 'OTP_INVALID', 'Vérification du code verrouillée : trop d\'essais', { locked: true, attemptsLeft: 0, order: { id: o.id, status: o.status } })
      if (verifyOtp(o.id, action.otp)) {
        const r = await prisma.opsOrder.updateMany({ where: { id: o.id, otpVerifiedAt: null, otpAttempts: { lt: OTP_MAX_ATTEMPTS } }, data: { otpVerifiedAt: new Date(nowMs), otpVerifiedBy: driverName } })
        if (r.count > 0) otpValid = true
        else { // course : déjà vérifiée entre-temps ou verrouillée
          const cur = await prisma.opsOrder.findUnique({ where: { id: o.id }, select: { otpVerifiedAt: true } })
          otpValid = cur?.otpVerifiedAt != null
          if (!otpValid) return fail(id, 'OTP_INVALID', 'Vérification du code verrouillée : trop d\'essais', { locked: true, attemptsLeft: 0 })
        }
      } else {
        await prisma.opsOrder.updateMany({ where: { id: o.id, otpVerifiedAt: null, otpAttempts: { lt: OTP_MAX_ATTEMPTS } }, data: { otpAttempts: { increment: 1 } } })
        const cur = await prisma.opsOrder.findUnique({ where: { id: o.id }, select: { otpAttempts: true } })
        const left = Math.max(0, OTP_MAX_ATTEMPTS - (cur?.otpAttempts ?? OTP_MAX_ATTEMPTS))
        await auditDriver(driver, 'driver.otp_failed', o.id, { attemptsLeft: left }, o.hubCode)
        return fail(id, 'OTP_INVALID', left === 0 ? 'Code incorrect : vérification verrouillée' : 'Code incorrect', { attemptsLeft: left, locked: left === 0 })
      }
    }
    // 2) exigence de preuve
    if (!proofRequirementMet(cfg.proofRequired, { otpValid, photoCount: proofs })) {
      return fail(id, 'PROOF_REQUIRED', cfg.proofRequired === 'otp' ? 'Le code de remise est obligatoire' : 'Code de remise valide ou photo obligatoire', { order: { id: o.id, status: o.status } })
    }
  } else if (type === 'noshow') {
    if (!noShowRequirementMet(action.reason, proofs)) {
      return fail(id, 'PROOF_REQUIRED', 'Motif (3 caractères minimum) et au moins une photo obligatoires', { order: { id: o.id, status: o.status } })
    }
  }

  // UPDATE atomique : ne réussit que si la commande est encore chez CE livreur dans le statut attendu
  const from = FROM_STATUS[type]
  const gLat = geo?.lat ?? null, gLng = geo?.lng ?? null, gDist = geo?.distanceM ?? null, gOk = geo?.ok ?? null
  let rows: { id: string }[]
  if (type === 'accept') {
    rows = await prisma.$queryRaw<{ id: string }[]>`UPDATE "OpsOrder" SET "status" = 'IN_TRANSPORT', "inTransportAt" = ${at} WHERE "id" = ${o.id} AND "driverId" = ${driver.id} AND "status" = ${from} RETURNING "id"`
  } else if (type === 'start') {
    rows = await prisma.$queryRaw<{ id: string }[]>`UPDATE "OpsOrder" SET "status" = 'START_DELIVERY', "startDeliveryAt" = ${at} WHERE "id" = ${o.id} AND "driverId" = ${driver.id} AND "status" = ${from} RETURNING "id"`
  } else if (type === 'deliver') {
    rows = await prisma.$queryRaw<{ id: string }[]>`UPDATE "OpsOrder" SET "status" = 'DELIVERED', "deliveredAt" = ${at}, "deliveredLat" = ${gLat}::double precision, "deliveredLng" = ${gLng}::double precision, "deliveryDistanceM" = ${gDist}::integer, "deliveryGeoOk" = ${gOk}::boolean WHERE "id" = ${o.id} AND "driverId" = ${driver.id} AND "status" = ${from} RETURNING "id"`
  } else {
    rows = await prisma.$queryRaw<{ id: string }[]>`UPDATE "OpsOrder" SET "status" = 'NO_SHOW', "noShowAt" = ${at}, "deliveredLat" = ${gLat}::double precision, "deliveredLng" = ${gLng}::double precision, "deliveryDistanceM" = ${gDist}::integer, "deliveryGeoOk" = ${gOk}::boolean WHERE "id" = ${o.id} AND "driverId" = ${driver.id} AND "status" = ${from} RETURNING "id"`
  }
  if (!rows.length) {
    const cur = await prisma.opsOrder.findFirst({ where: { id: o.id, driverId: driver.id }, select: { status: true } })
    return fail(id, 'BAD_STATE', `Transition impossible depuis ${cur?.status ?? 'inconnu'}`, { order: { id: o.id, status: cur?.status ?? o.status } })
  }

  await prisma.opsOrderEvent.createMany({ data: [{ orderId: o.id, fromStatus: from, toStatus: target, at, source: 'driver' }], skipDuplicates: true })
  // poussée best effort vers le back-office (rejouée par flushOutbox) : le statut est dans courierRef
  try { await prisma.$executeRaw`INSERT INTO "OpsOutbox" ("id","kind","externalId","courierRef") VALUES (${randomUUID()}, 'status', ${o.externalId}, ${target})` } catch (e) { console.warn('[driver-action] OpsOutbox indisponible:', e instanceof Error ? e.message : e) }
  await auditDriver(driver, `driver.${type}`, o.id, { from, to: target, geoOk: gOk, distanceM: gDist, proofs }, o.hubCode)
  const { bumpOpsEpoch } = await import('@/lib/ops-cache')
  bumpOpsEpoch()
  return { id, ok: true, order: { id: o.id, status: target } }
}

async function attendanceAction(driver: DriverLite, action: DriverActionIn, nowMs: number): Promise<ActionResult> {
  const { prisma } = await import('@/lib/prisma')
  const att = await import('@/lib/ops-attendance')
  const { isDayLocked, LOCKED_MESSAGE } = await import('@/lib/ops-lock')
  const { attendanceKey } = await import('@/lib/ops-time')
  const id = action.id
  // heure du pointage : celle du téléphone, bornée (pas dans le futur, pas plus de 24 h dans le passé)
  const t = toMs(action.at)
  const atMs = t != null && t <= nowMs + FUTURE_TOLERANCE_MS && t >= nowMs - 86_400_000 ? t : nowMs
  const day = localDay(atMs)
  if (await isDayLocked(day)) return fail(id, 'PERIOD_LOCKED', LOCKED_MESSAGE)

  const name = att.fullName(driver)
  const existing = await prisma.driverAttendance.findUnique({ where: { driverName_date: { driverName: name, date: attendanceKey(day) } } })
  const view = (r: { status: string; checkIn: Date | null; checkOut: Date | null; workedMinutes: number | null; lateMinutes: number | null; checkInGeoOk?: boolean | null; checkInDistanceM?: number | null }) =>
    ({ day, status: r.status, checkIn: r.checkIn?.toISOString() ?? null, checkOut: r.checkOut?.toISOString() ?? null, workedMinutes: r.workedMinutes, lateMinutes: r.lateMinutes, geoOk: r.checkInGeoOk ?? null, distanceM: r.checkInDistanceM ?? null })

  if (action.type === 'checkin') {
    if (existing?.checkIn) return { id, ok: true, code: 'ALREADY_CHECKED_IN', attendance: view(existing) } // idempotent : l'heure déjà enregistrée est conservée
    const checkIn = new Date(atMs)
    const patch: { checkIn: Date; status?: string; notes?: string } = { checkIn }
    if (!existing?.notes) patch.notes = 'application livreur' // motif automatique
    // un livreur marqué « absent » qui se présente est repointé (présent / retard selon le planning) ; « congé » n'est jamais écrasé
    if (existing?.status === 'absent') patch.status = (await att.deriveFields(name, day, { checkIn, checkOut: null, status: null })).status
    const { rec } = await att.setAttendance(driver, driver.hub?.name ?? null, day, patch, { status: 'present', checkIn })
    const g = geoCheck(action.geo, { lat: driver.hub?.lat, lng: driver.hub?.lng }, driverAppConfig().geofenceMeters)
    const raw = action.geo && validLatLng(action.geo.lat, action.geo.lng) ? action.geo : null
    const upd = await prisma.driverAttendance.update({
      where: { id: rec.id },
      data: { checkInLat: g?.lat ?? raw?.lat ?? null, checkInLng: g?.lng ?? raw?.lng ?? null, checkInDistanceM: g?.distanceM ?? null, checkInGeoOk: g?.ok ?? null },
    })
    await auditDriver(driver, 'driver.checkin', rec.id, { day, status: rec.status, lateMinutes: rec.lateMinutes, geoOk: g?.ok ?? null, distanceM: g?.distanceM ?? null }, driver.hub?.code)
    const { bumpOpsEpoch } = await import('@/lib/ops-cache'); bumpOpsEpoch()
    return { id, ok: true, attendance: view(upd) }
  }

  // checkout
  if (!existing?.checkIn) return fail(id, 'NO_CHECKIN', 'Aucune arrivée pointée aujourd\'hui')
  if (existing.checkOut) return { id, ok: true, code: 'ALREADY_CHECKED_OUT', attendance: view(existing) }
  const checkOut = new Date(Math.max(atMs, existing.checkIn.getTime()))
  const patch: { checkOut: Date; notes?: string } = { checkOut }
  if (!existing.notes) patch.notes = 'application livreur'
  const { rec } = await att.setAttendance(driver, driver.hub?.name ?? null, day, patch)
  await auditDriver(driver, 'driver.checkout', rec.id, { day, workedMinutes: rec.workedMinutes }, driver.hub?.code)
  const { bumpOpsEpoch } = await import('@/lib/ops-cache'); bumpOpsEpoch()
  return { id, ok: true, attendance: view(rec) }
}

/** Journal d'audit : l'acteur est « Livreur <code> » (pas de nom, pas de code OTP, pas de coordonnées). */
async function auditDriver(driver: DriverLite, action: string, entityId: string, payload: unknown, hubCode?: string | null) {
  const { audit } = await import('@/lib/ops-auth')
  await audit({ userId: `driver:${driver.code}`, tenantId: driver.tenantId, role: 'VIEWER', name: `Livreur ${driver.code}`, email: '' }, action, action.includes('check') ? 'attendance' : 'order', entityId, payload, hubCode)
}
