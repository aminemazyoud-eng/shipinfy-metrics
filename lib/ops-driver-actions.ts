/**
 * lib/ops-driver-actions.ts — actions de l'application livreur (Sprint 20) : machine à états stricte, preuves, géolocalisation, pointage.
 *
 * Deux parties :
 *  1. FONCTIONS PURES (nextStatus, clampClientTime, proofRequirementMet, parseActions, …) — testées sans base ;
 *  2. processDriverAction : traitement d'UNE action (idempotent par identifiant généré par le téléphone, UPDATE atomique conditionné).
 * Les modules qui touchent la base sont importés à la demande pour que la partie pure reste importable dans un script de test.
 */
import { verifyOtp, OTP_MAX_ATTEMPTS } from '@/lib/ops-otp'
import { geoCheck, geoGate, validLatLng } from '@/lib/geo'
import { localDay } from '@/lib/tz'
import { CFG } from '@/lib/ops-config'

export const ACTION_TYPES = ['accept', 'start', 'arrive', 'deliver', 'noshow', 'checkin', 'checkout'] as const
export type ActionType = (typeof ACTION_TYPES)[number]
export type OrderActionType = 'accept' | 'start' | 'arrive' | 'deliver' | 'noshow'
export const MAX_ACTIONS_PER_SYNC = 50
export const FUTURE_TOLERANCE_MS = 5 * 60_000
export const MAX_PROOFS_PER_ORDER = 5
export const PROOF_MAX_KB = 400
export const MIN_NOSHOW_REASON = 3

// ─── 1. FONCTIONS PURES ───────────────────────────────────────────────────────────────────────────

/** Statut requis AVANT chaque action et statut obtenu APRÈS (aucune étape sautée). */
export const FROM_STATUS: Record<OrderActionType, string> = { accept: 'ASSIGNED', start: 'IN_TRANSPORT', arrive: 'START_DELIVERY', deliver: 'START_DELIVERY', noshow: 'START_DELIVERY' }
export const TO_STATUS: Record<OrderActionType, string> = { accept: 'IN_TRANSPORT', start: 'START_DELIVERY', arrive: 'START_DELIVERY', deliver: 'DELIVERED', noshow: 'NO_SHOW' }

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
  otp?: string; reason?: string; reasonCode?: string; proofClientIds?: string[]
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
  if (typeof a.reasonCode === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(a.reasonCode)) out.reasonCode = a.reasonCode
  if (Array.isArray(a.proofClientIds)) out.proofClientIds = a.proofClientIds.filter((x): x is string => typeof x === 'string').slice(0, 10)
  return { action: out }
}

/** Seuils de l'application (lus dans CFG, défauts 400 m / 400 Ko / preuve code-ou-photo / géofence bloquante / scan de chargement exigé). */
export function driverAppConfig() {
  return {
    geofenceMeters: CFG.geofenceMeters ?? 400,
    deliveryGeofenceMeters: CFG.deliveryGeofenceMeters ?? 400,
    geofenceMode: (CFG.geofenceMode === 'soft' ? 'soft' : 'block') as 'block' | 'soft',
    loadScanRequired: (CFG.loadScanRequired ?? 1) !== 0,
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
  distanceM?: number; radiusM?: number; remaining?: number
  autoCheckout?: { at: string }
}

// Échecs NON mémorisés : la même action (même identifiant) pourra être rejouée une fois la condition levée (photo arrivée, panne passée…).
const RETRYABLE = new Set(['PROOF_REQUIRED', 'SERVER_ERROR', 'OUT_OF_RANGE', 'GEO_REQUIRED', 'ARRIVE_REQUIRED', 'LOAD_INCOMPLETE'])

const fail = (id: string, code: string, message: string, extra: Partial<ActionResult> = {}): ActionResult => ({ id, ok: false, code, error: code, message, ...extra })

interface DriverLite { id: string; code: string; vehicleId?: string | null; vehicle?: { plate: string } | null; firstName: string; lastName: string; tenantId: string | null; hub: { code: string; name: string; lat: number | null; lng: number | null } | null }

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
    select: { id: true, externalId: true, status: true, hubCode: true, lat: true, lng: true, otpVerifiedAt: true, otpAttempts: true, arrivedAt: true },
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

  if (type === 'arrive') {
    // arrivée chez le client : pose OpsOrder.arrivedAt (une seule fois) ; hors rayon => refusée en mode 'block', simple signalement en 'soft'
    if (o.arrivedAt) return { id, ok: true, code: 'ALREADY_ARRIVED', order: { id: o.id, status: o.status } }
    const gate = geoGate(action.geo, o, cfg.deliveryGeofenceMeters, cfg.geofenceMode)
    if (!gate.pass) {
      return fail(id, gate.code, gate.code === 'GEO_REQUIRED' ? "Position GPS requise pour signaler l'arrivée" : `Vous êtes à ${gate.check?.distanceM} m de l'adresse (maximum ${cfg.deliveryGeofenceMeters} m)`,
        { distanceM: gate.check?.distanceM, radiusM: cfg.deliveryGeofenceMeters, order: { id: o.id, status: o.status } })
    }
    const ar = await prisma.$queryRaw<{ id: string }[]>`UPDATE "OpsOrder" SET "arrivedAt" = ${at} WHERE "id" = ${o.id} AND "driverId" = ${driver.id} AND "status" = ${FROM_STATUS.arrive} AND "arrivedAt" IS NULL RETURNING "id"`
    if (!ar.length) {
      const cur = await prisma.opsOrder.findFirst({ where: { id: o.id, driverId: driver.id }, select: { status: true, arrivedAt: true } })
      if (cur?.arrivedAt) return { id, ok: true, code: 'ALREADY_ARRIVED', order: { id: o.id, status: cur.status } }
      return fail(id, 'BAD_STATE', `Transition impossible depuis ${cur?.status ?? 'inconnu'}`, { order: { id: o.id, status: cur?.status ?? o.status } })
    }
    await auditDriver(driver, 'driver.arrive', o.id, { geoOk: gate.check?.ok ?? null, distanceM: gate.check?.distanceM ?? null, mode: cfg.geofenceMode }, o.hubCode)
    const { bumpOpsEpoch } = await import('@/lib/ops-cache')
    bumpOpsEpoch()
    return { id, ok: true, order: { id: o.id, status: o.status }, distanceM: gate.check?.distanceM, radiusM: cfg.deliveryGeofenceMeters }
  }

  if (type === 'start' && cfg.loadScanRequired) {
    // contrôle du chargement : tous les bacs de la tournée doivent avoir été scannés (commandes sans bacs : aucun blocage)
    const remaining = await remainingToLoad(o.id)
    if (remaining > 0) return fail(id, 'LOAD_INCOMPLETE', `Chargement incomplet : ${remaining} bac(s) à scanner`, { remaining, order: { id: o.id, status: o.status } })
  }

  if (type === 'deliver' || type === 'noshow') {
    proofs = await prisma.opsProof.count({ where: { orderId: o.id, driverCode: driver.code } })
    geo = geoCheck(action.geo, o, cfg.deliveryGeofenceMeters)
  }

  if (type === 'deliver') {
    // 0) arrivée obligatoire en mode 'block' (en 'soft' : simple signalement, la livraison reste possible)
    if (cfg.geofenceMode === 'block' && !o.arrivedAt) return fail(id, 'ARRIVE_REQUIRED', "Signalez d'abord votre arrivée chez le client", { order: { id: o.id, status: o.status } })
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
    // motif OBLIGATOIRE, choisi dans la nomenclature (OpsReason) ; le texte libre devient facultatif (le libellé du motif en tient lieu)
    if (!action.reasonCode) return fail(id, 'REASON_REQUIRED', 'Choisissez un motif de non-livraison', { order: { id: o.id, status: o.status } })
    const { activeReason } = await import('@/lib/ops-reasons')
    const rs = await activeReason(action.reasonCode)
    if (!rs) return fail(id, 'REASON_INVALID', 'Motif inconnu ou désactivé', { order: { id: o.id, status: o.status } })
    if (!noShowRequirementMet(action.reason?.trim() || rs.label, proofs)) {
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
    rows = await prisma.$queryRaw<{ id: string }[]>`UPDATE "OpsOrder" SET "status" = 'NO_SHOW', "noShowAt" = ${at}, "reasonCode" = ${action.reasonCode ?? null}, "deliveredLat" = ${gLat}::double precision, "deliveredLng" = ${gLng}::double precision, "deliveryDistanceM" = ${gDist}::integer, "deliveryGeoOk" = ${gOk}::boolean WHERE "id" = ${o.id} AND "driverId" = ${driver.id} AND "status" = ${from} RETURNING "id"`
  }
  if (!rows.length) {
    const cur = await prisma.opsOrder.findFirst({ where: { id: o.id, driverId: driver.id }, select: { status: true } })
    return fail(id, 'BAD_STATE', `Transition impossible depuis ${cur?.status ?? 'inconnu'}`, { order: { id: o.id, status: cur?.status ?? o.status } })
  }

  await prisma.opsOrderEvent.createMany({ data: [{ orderId: o.id, fromStatus: from, toStatus: target, at, source: 'driver' }], skipDuplicates: true })
  // poussée best effort vers le back-office (rejouée par flushOutbox) : le statut est dans courierRef
  try { await prisma.$executeRaw`INSERT INTO "OpsOutbox" ("id","kind","externalId","courierRef") VALUES (${randomUUID()}, 'status', ${o.externalId}, ${target})` } catch (e) { console.warn('[driver-action] OpsOutbox indisponible:', e instanceof Error ? e.message : e) }
  await auditDriver(driver, `driver.${type}`, o.id, { from, to: target, geoOk: gOk, distanceM: gDist, proofs, ...(type === 'noshow' ? { reasonCode: action.reasonCode } : {}) }, o.hubCode)
  const { bumpOpsEpoch } = await import('@/lib/ops-cache')
  bumpOpsEpoch()
  // ETA des stops suivants recalculées (best effort, sans attendre)
  void import('@/lib/ops-tours').then(m => m.recomputeEtaForOrder(o.id)).catch(() => {})
  const out: ActionResult = { id, ok: true, order: { id: o.id, status: target } }
  if (type === 'deliver' || type === 'noshow') {
    const co = await maybeAutoCheckout(driver, at.getTime(), nowMs)
    if (co) out.autoCheckout = co
  }
  return out
}

/** Check-out automatique : dernier stop clôturé (livré / non livré) et plus aucune commande ouverte => fin de journée (idempotent). */
async function maybeAutoCheckout(driver: DriverLite, atMs: number, nowMs: number): Promise<{ at: string } | null> {
  try {
    const { prisma } = await import('@/lib/prisma')
    const open = await prisma.opsOrder.count({ where: { driverId: driver.id, status: { in: ['ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY'] } } })
    if (open > 0) return null
    const at = new Date(Math.min(atMs, nowMs)).toISOString()
    const r = await attendanceAction(driver, { id: `autoco-${driver.code}-${localDay(atMs)}`, type: 'checkout', at }, nowMs)
    return r.ok && !r.code ? { at } : null
  } catch (e) { console.warn('[driver-action] check-out automatique:', e instanceof Error ? e.message : e); return null }
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
    // check-in = GPS dans le rayon du hub (refusé hors rayon en mode 'block' ; le premier scan d'un bac de la tournée le déclenche aussi)
    const cfg = driverAppConfig()
    const gate = geoGate(action.geo, { lat: driver.hub?.lat, lng: driver.hub?.lng }, cfg.geofenceMeters, cfg.geofenceMode)
    if (!gate.pass) {
      return fail(id, gate.code, gate.code === 'GEO_REQUIRED' ? "Position GPS requise pour pointer l'arrivée au hub" : `Vous êtes à ${gate.check?.distanceM} m du hub (maximum ${cfg.geofenceMeters} m)`, { distanceM: gate.check?.distanceM, radiusM: cfg.geofenceMeters })
    }
    const checkIn = new Date(atMs)
    const patch: { checkIn: Date; status?: string; notes?: string } = { checkIn }
    if (!existing?.notes) patch.notes = 'application livreur' // motif automatique
    // un livreur marqué « absent » qui se présente est repointé (présent / retard selon le planning) ; « congé » n'est jamais écrasé
    if (existing?.status === 'absent') patch.status = (await att.deriveFields(name, day, { checkIn, checkOut: null, status: null })).status
    const { rec } = await att.setAttendance(driver, driver.hub?.name ?? null, day, patch, { status: 'present', checkIn })
    const g = gate.check
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
async function auditDriver(driver: DriverLite, action: string, entityId: string, payload: unknown, hubCode?: string | null, entity?: string) {
  const { audit } = await import('@/lib/ops-auth')
  await audit({ userId: `driver:${driver.code}`, tenantId: driver.tenantId, role: 'VIEWER', name: `Livreur ${driver.code}`, email: '' }, action, entity ?? (action.includes('check') ? 'attendance' : 'order'), entityId, payload, hubCode)
}

// ─── 3. CONTRÔLE DU CHARGEMENT (scan des bacs) ───────────────────────────────────────────────────

/** Quantité restant à charger sur une liste d'articles (jamais négative). Fonction pure. */
export function remainingQty(items: { qty: number; loadedQty: number }[]): number {
  return items.reduce((n, i) => n + Math.max(0, (i.qty || 0) - (i.loadedQty || 0)), 0)
}

/** Code-barres accepté : 1 à 64 caractères imprimables sans espace. Renvoie la valeur nettoyée ou null. */
export function normalizeBarcode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const b = raw.trim()
  return /^[A-Za-z0-9._\-/+:#]{1,64}$/.test(b) ? b : null
}

const TERMINAL_STATUSES = ['DELIVERED', 'NO_SHOW', 'CANCELLED']

/** Reste à charger pour la tournée de cette commande (tous ses stops non terminés) ; sans tournée : cette commande seule. */
async function remainingToLoad(orderId: string): Promise<number> {
  const { prisma } = await import('@/lib/prisma')
  const stop = await prisma.opsStop.findUnique({ where: { orderId }, select: { tourId: true } })
  let ids = [orderId]
  if (stop) {
    const stops = await prisma.opsStop.findMany({ where: { tourId: stop.tourId }, select: { orderId: true }, take: 500 })
    ids = [...new Set([orderId, ...stops.map(s => s.orderId)])]
  }
  const live = await prisma.opsOrder.findMany({ where: { id: { in: ids }, status: { notIn: TERMINAL_STATUSES } }, select: { id: true } })
  if (!live.length) return 0
  const items = await prisma.opsOrderItem.findMany({ where: { orderId: { in: live.map(l => l.id) } }, select: { qty: true, loadedQty: true } })
  return remainingQty(items)
}

export interface LoadItem { id: string; orderId: string; ref: string; label: string; qty: number; loadedQty: number; barcode: string | null }
export interface LoadOverview { items: LoadItem[]; total: number; loaded: number; remaining: number; complete: boolean; tourId: string | null }

/** Articles à charger du livreur : commandes ouvertes qui lui sont assignées + stops de sa tournée du jour. */
export async function loadOverview(driver: DriverLite, nowMs = Date.now()): Promise<LoadOverview> {
  const { prisma } = await import('@/lib/prisma')
  const tours = await prisma.opsTour.findMany({ where: { day: localDay(nowMs), driverCode: driver.code, status: { not: 'DONE' } }, orderBy: { rotation: 'asc' }, select: { id: true } })
  const stops = tours.length ? await prisma.opsStop.findMany({ where: { tourId: { in: tours.map(t => t.id) } }, select: { orderId: true }, take: 500 }) : []
  const orders = await prisma.opsOrder.findMany({
    where: { status: { notIn: TERMINAL_STATUSES }, OR: [{ driverId: driver.id, status: { in: ['ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY'] } }, ...(stops.length ? [{ id: { in: stops.map(s => s.orderId) } }] : [])] },
    select: { id: true, reference: true, externalId: true }, take: 500,
  })
  const refOf = new Map(orders.map(o => [o.id, o.reference ?? o.externalId]))
  const rows = orders.length ? await prisma.opsOrderItem.findMany({ where: { orderId: { in: orders.map(o => o.id) } }, orderBy: [{ orderId: 'asc' }, { createdAt: 'asc' }], take: 1000 }) : []
  const items: LoadItem[] = rows.map(r => ({ id: r.id, orderId: r.orderId, ref: refOf.get(r.orderId) ?? '', label: r.label ?? r.sku ?? r.barcode ?? 'Bac', qty: r.qty, loadedQty: r.loadedQty, barcode: r.barcode }))
  const total = items.reduce((n, i) => n + i.qty, 0), remaining = remainingQty(items)
  return { items, total, loaded: total - remaining, remaining, complete: remaining === 0, tourId: tours[0]?.id ?? null }
}

export interface ScanInput { id: string; barcode: unknown; geo?: unknown; at?: unknown }
export interface ScanResult {
  id: string; ok: boolean; code?: string; message?: string; replayed?: boolean
  matched?: { itemId: string; orderId: string; ref: string; label: string; qty: number; loadedQty: number }
  overview?: LoadOverview
  checkin?: { done: boolean; code?: string; message?: string; attendance?: Record<string, unknown> }
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/** Mémorise le résultat d'une action (idempotence) ; en cas de course, le premier résultat fait foi. */
async function remember<T extends { id: string }>(driver: DriverLite, id: string, type: string, ok: boolean, res: T, payload: unknown, orderId?: string | null): Promise<T> {
  const { prisma } = await import('@/lib/prisma')
  try {
    await prisma.opsDriverAction.create({ data: { id, driverCode: driver.code, orderId: orderId ?? null, type, ok, result: JSON.stringify(res), payload: JSON.stringify(payload) } })
  } catch {
    const first = await prisma.opsDriverAction.findUnique({ where: { id } }).catch(() => null)
    if (first && first.driverCode === driver.code) { try { return { ...(JSON.parse(first.result ?? '{}') as T), id, replayed: true } } catch { /* garde res */ } }
  }
  return res
}
/** Résultat déjà mémorisé pour cet identifiant (ou conflit si un autre livreur l'a utilisé). */
async function recalled(driver: DriverLite, id: string): Promise<Record<string, unknown> | null> {
  const { prisma } = await import('@/lib/prisma')
  const prev = await prisma.opsDriverAction.findUnique({ where: { id } })
  if (!prev) return null
  if (prev.driverCode !== driver.code) return { id, ok: false, code: 'ID_CONFLICT', message: 'Identifiant déjà utilisé' }
  try { return { ...(JSON.parse(prev.result ?? '{}') as Record<string, unknown>), id, replayed: true } } catch { return { id, ok: prev.ok, replayed: true } }
}

/**
 * Scan d'un bac : incrémente OpsOrderItem.loadedQty (UPDATE atomique borné par qty), idempotent par `id`.
 * Premier scan de la journée : déclenche aussi le check-in (GPS dans le rayon du hub — refusé hors rayon, sans bloquer le scan).
 */
export async function processScan(driver: DriverLite, input: ScanInput, nowMs = Date.now()): Promise<ScanResult> {
  const { prisma } = await import('@/lib/prisma')
  const { applyOpsSettings } = await import('@/lib/ops-settings')
  await applyOpsSettings()
  const id = input.id
  if (!ID_RE.test(id)) return { id: '', ok: false, code: 'BAD_REQUEST', message: 'Identifiant invalide' }
  const prev = await recalled(driver, id)
  if (prev) return prev as unknown as ScanResult
  const barcode = normalizeBarcode(input.barcode)
  if (!barcode) return { id, ok: false, code: 'BAD_BARCODE', message: 'Code-barres illisible' }

  const before = await loadOverview(driver, nowMs)
  const candidates = before.items.filter(i => i.barcode === barcode)
  let res: ScanResult
  if (!candidates.length) res = { id, ok: false, code: 'UNKNOWN_BARCODE', message: 'Ce bac n\'appartient pas à votre tournée', overview: before }
  else {
    let hit: { itemId: string; orderId: string; ref: string; label: string; qty: number; loadedQty: number } | null = null
    for (const c of candidates) {
      if (c.loadedQty >= c.qty) continue
      const rows = await prisma.$queryRaw<{ loadedQty: number }[]>`UPDATE "OpsOrderItem" SET "loadedQty" = "loadedQty" + 1, "loadedAt" = ${new Date(nowMs)}, "loadedBy" = ${driver.code} WHERE "id" = ${c.id} AND "loadedQty" < "qty" RETURNING "loadedQty"`
      if (rows.length) { hit = { itemId: c.id, orderId: c.orderId, ref: c.ref, label: c.label, qty: c.qty, loadedQty: rows[0].loadedQty }; break }
    }
    const overview = await loadOverview(driver, nowMs)
    res = hit ? { id, ok: true, matched: hit, overview } : { id, ok: false, code: 'ALREADY_LOADED', message: 'Ce bac est déjà entièrement scanné', overview }
    if (hit) await auditDriver(driver, 'driver.scan', hit.orderId, { itemId: hit.itemId, loaded: hit.loadedQty, qty: hit.qty }, driver.hub?.code, 'order')
  }

  // premier scan : check-in officiel (GPS dans le rayon du hub) — ne bloque jamais le scan lui-même
  if (res.ok) {
    try {
      const geo = input.geo as { lat?: unknown; lng?: unknown; accuracy?: unknown } | undefined
      const g = geo && validLatLng(geo.lat, geo.lng) ? { lat: geo.lat as number, lng: geo.lng as number, accuracy: typeof geo.accuracy === 'number' ? geo.accuracy : undefined } : undefined
      const ci = await attendanceAction(driver, { id: `scanci-${driver.code}-${localDay(nowMs)}`, type: 'checkin', geo: g, at: new Date(nowMs).toISOString() }, nowMs)
      res.checkin = { done: ci.ok, code: ci.code, message: ci.ok ? undefined : ci.message, attendance: ci.attendance }
    } catch (e) { console.warn('[driver-scan] check-in:', e instanceof Error ? e.message : e) }
  }
  return remember(driver, id, 'scan', res.ok, res, { barcode: barcode.slice(0, 20) }, res.matched?.orderId)
}

// ─── 4. COMPTEUR KILOMÉTRIQUE ET CARBURANT ───────────────────────────────────────────────────────

export const MAX_KM = 2_000_000

/** Valide un relevé de compteur. Renvoie le kilométrage arrondi (0,1 km) ou une erreur. Fonction pure. */
export function parseKm(v: unknown): { km: number } | { error: string } {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_KM) return { error: 'Kilométrage invalide' }
  return { km: Math.round(v * 10) / 10 }
}
/** Cohérence départ / retour : le retour ne peut pas être inférieur au départ. Fonction pure. */
export function kmConsistent(kind: 'start' | 'end', km: number, tour: { kmStart: number | null; kmEnd: number | null }): string | null {
  if (kind === 'end' && tour.kmStart != null && km < tour.kmStart) return 'KM_LOWER'
  if (kind === 'start' && tour.kmEnd != null && km > tour.kmEnd) return 'KM_HIGHER'
  return null
}

export interface OdoResult { id: string; ok: boolean; code?: string; message?: string; replayed?: boolean; tour?: { id: string; kmStart: number | null; kmEnd: number | null; rotation: number } }

/** Relevé du compteur sur l'OpsTour du jour (créée en rotation 1 si absente). Idempotent par `id`. */
export async function setOdometer(driver: DriverLite, input: { id: string; kind: unknown; km: unknown }, nowMs = Date.now()): Promise<OdoResult> {
  const { prisma } = await import('@/lib/prisma')
  const id = input.id
  if (!ID_RE.test(id)) return { id: '', ok: false, code: 'BAD_REQUEST', message: 'Identifiant invalide' }
  const prev = await recalled(driver, id)
  if (prev) return prev as unknown as OdoResult
  if (input.kind !== 'start' && input.kind !== 'end') return { id, ok: false, code: 'BAD_REQUEST', message: 'kind doit valoir start ou end' }
  const kind = input.kind
  const k = parseKm(input.km)
  if ('error' in k) return { id, ok: false, code: 'BAD_KM', message: k.error }
  const day = localDay(nowMs)
  const find = () => prisma.opsTour.findMany({ where: { day, driverCode: driver.code }, orderBy: { rotation: 'asc' } })
  let tours = await find()
  if (!tours.length) {
    try { await prisma.opsTour.create({ data: { day, driverCode: driver.code, rotation: 1, hubCode: driver.hub?.code ?? null, vehicleRef: driver.vehicle?.plate ?? null } }) } catch { /* course : créée entre-temps */ }
    tours = await find()
  }
  const live = tours.filter(t => t.status !== 'DONE')
  const tour = kind === 'start'
    ? (live.find(t => t.kmStart == null) ?? live[0] ?? tours[tours.length - 1])
    : ([...tours].reverse().find(t => t.kmStart != null && t.kmEnd == null) ?? live[live.length - 1] ?? tours[tours.length - 1])
  const bad = kmConsistent(kind, k.km, tour)
  if (bad) return { id, ok: false, code: bad, message: bad === 'KM_LOWER' ? `Le kilométrage de retour doit être supérieur ou égal au départ (${tour.kmStart})` : `Le kilométrage de départ doit être inférieur ou égal au retour (${tour.kmEnd})` }
  const upd = await prisma.opsTour.update({ where: { id: tour.id }, data: kind === 'start' ? { kmStart: k.km } : { kmEnd: k.km } })
  await auditDriver(driver, `driver.odometer_${kind}`, tour.id, { km: k.km, previous: kind === 'start' ? tour.kmStart : tour.kmEnd }, driver.hub?.code, 'tour')
  return remember(driver, id, 'odometer', true, { id, ok: true, tour: { id: upd.id, kmStart: upd.kmStart, kmEnd: upd.kmEnd, rotation: upd.rotation } }, { kind, km: k.km })
}

export interface FuelResult { id: string; ok: boolean; code?: string; message?: string; replayed?: boolean; fuelLogId?: string }

/** Plein de carburant -> OpsFuelLog du véhicule du livreur. Idempotent par `id`. */
export async function logFuel(driver: DriverLite & { vehicleId?: string | null }, input: { id: string; liters: unknown; amount: unknown; km?: unknown; station?: unknown }, nowMs = Date.now()): Promise<FuelResult> {
  const { prisma } = await import('@/lib/prisma')
  const id = input.id
  if (!ID_RE.test(id)) return { id: '', ok: false, code: 'BAD_REQUEST', message: 'Identifiant invalide' }
  const prev = await recalled(driver, id)
  if (prev) return prev as unknown as FuelResult
  if (!driver.vehicleId) return { id, ok: false, code: 'NO_VEHICLE', message: 'Aucun véhicule n\'est affecté à ce livreur : contactez le dispatch' }
  const l = input.liters, a = input.amount
  if (typeof l !== 'number' || !Number.isFinite(l) || l <= 0 || l > 500) return { id, ok: false, code: 'BAD_LITERS', message: 'Litres invalides (0 à 500)' }
  if (typeof a !== 'number' || !Number.isFinite(a) || a <= 0 || a > 20_000) return { id, ok: false, code: 'BAD_AMOUNT', message: 'Montant invalide (0 à 20 000 MAD)' }
  const km = input.km == null ? null : parseKm(input.km)
  if (km && 'error' in km) return { id, ok: false, code: 'BAD_KM', message: km.error }
  const station = typeof input.station === 'string' ? input.station.trim().slice(0, 80) || null : null
  const row = await prisma.opsFuelLog.create({
    data: { vehicleId: driver.vehicleId, date: new Date(nowMs), liters: Math.round(l * 100) / 100, amountMad: Math.round(a * 100) / 100, odometerKm: km ? km.km : null, station, notes: `application livreur ${driver.code}` },
    select: { id: true },
  })
  await auditDriver(driver, 'driver.fuel', row.id, { liters: l, amountMad: a }, driver.hub?.code, 'fleet')
  return remember(driver, id, 'fuel', true, { id, ok: true, fuelLogId: row.id }, { liters: l, amount: a })
}
