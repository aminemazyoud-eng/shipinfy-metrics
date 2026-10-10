/**
 * lib/alert-engine.ts — Moteur d'alertes prédictives Shipinfy
 * Sprint 7 — Alertes prédictives retards livraison + Slack webhook
 *
 * Modes :
 *   Standard — tournée planifiée (deliveryTimeEnd comme deadline)
 *   Express  — < 60 min (no-op pour l'instant, LiveOrder non disponible avant Sprint Express 1)
 *
 * Levels :
 *   1 = warning   → in-app uniquement
 *   2 = danger    → in-app + Slack
 *   3 = critical  → in-app + Slack + log email escalade
 */

import { prisma } from '@/lib/prisma'
import { notify } from '@/lib/notify'

export type AlertMode  = 'standard' | 'express'
export type AlertLevel = 1 | 2 | 3
export type AlertType  = 'delay_risk' | 'delay_confirmed' | 'gps_blocked' | 'predictive' | 'cold_chain'

export interface AlertPayload {
  orderId?:    string
  reportId?:   string
  driverName?: string
  mode:        AlertMode
  level:       AlertLevel
  type:        AlertType
  message:     string
}

// ── Seuils Mode Standard (% du créneau écoulé) ──────────────────────────────
export const STANDARD_THRESHOLDS = {
  WARNING:  0.80,
  DANGER:   0.90,
  CRITICAL: 1.00,
} as const

// ── Seuils Mode Express (minutes depuis assignation) ────────────────────────
export const EXPRESS_THRESHOLDS = {
  PALIER_1: 45,
  PALIER_2: 50,
  PALIER_3: 55,
} as const

// Fenêtre de déduplication par (commande, type, niveau) — Sprint 17 B2 : 2 h (avant 30 min → 3 synchros = 3 alertes identiques)
export const ALERT_DEDUPE_MS = 2 * 60 * 60 * 1000

// ── Créer une DeliveryAlert avec déduplication 2 h ─────────────────────────
/** Retourne true si l'alerte a été réellement créée, false si elle a été dédupliquée (aucune notification dans ce cas). */
export async function createDeliveryAlert(payload: AlertPayload): Promise<boolean> {
  // Déduplication : pas 2 alertes identiques pour la même commande dans les 2 h
  if (payload.orderId) {
    const recent = await prisma.deliveryAlert.findFirst({
      where: {
        orderId:     payload.orderId,
        type:        payload.type,
        level:       payload.level,
        triggeredAt: { gte: new Date(Date.now() - ALERT_DEDUPE_MS) },
      },
    })
    if (recent) return false
  }

  await prisma.deliveryAlert.create({
    data: {
      orderId:    payload.orderId    ?? null,
      reportId:   payload.reportId   ?? null,
      driverName: payload.driverName ?? null,
      mode:       payload.mode,
      level:      payload.level,
      type:       payload.type,
      message:    payload.message,
      channel:    'inapp',
    },
  })

  // Sprint 17 — level >= 2 : notification sortante via notify() (direct OU n8n)
  //   level 2 → Slack ; level 3 → Slack + Email (si ALERT_EMAIL_TO configuré)
  if (payload.level >= 2) {
    const modeLabel = payload.mode === 'express' ? 'Express <60min' : 'Tournée Standard'
    const channels: ('email' | 'slack')[] = ['slack']
    const alertEmail = process.env.ALERT_EMAIL_TO?.split(',').map(s => s.trim()).filter(Boolean)
    if (payload.level >= 3 && alertEmail?.length) channels.push('email')

    await notify({
      kind:       'alert',
      event:      'alert_critical',
      title:      `${payload.level === 3 ? '🔴 [CRITIQUE]' : '🟠 [ALERTE]'} Shipinfy — ${modeLabel}`,
      summary:    `${payload.message}${payload.driverName ? `\n> Livreur : ${payload.driverName}` : ''}`,
      channels,
      recipients: channels.includes('email') ? alertEmail : undefined,
      alertLevel: payload.level,
      reportId:   payload.reportId,
      data: {
        level:      payload.level,
        type:       payload.type,
        mode:       payload.mode,
        message:    payload.message,
        driverName: payload.driverName ?? null,
        orderId:    payload.orderId ?? null,
        reportId:   payload.reportId ?? null,
      },
    }).catch((e) => console.error('[AlertEngine] notify error:', e))
  }
  return true
}

// ── Moteur Standard — vérifie retards tournée ───────────────────────────────
export async function checkStandardDelays(): Promise<{ checked: number; created: number }> {
  const report = await prisma.deliveryReport.findFirst({
    where:   { isActive: true },
    orderBy: { uploadedAt: 'desc' },
  })
  if (!report) return { checked: 0, created: 0 }

  // Commandes en cours : assignées mais pas encore livrées ni NO_SHOW
  const orders = await prisma.deliveryOrder.findMany({
    where: {
      reportId: report.id,
      shippingWorkflowStatus: {
        notIn: ['DELIVERED', 'NO_SHOW', 'CANCELLED'],
      },
      deliveryTimeEnd: { not: null },
    },
    select: {
      id:                     true,
      deliveryTimeEnd:        true,
      dateTimeWhenOrderSent:  true,
      dateTimeWhenAssigned:   true,
      livreurFirstName:       true,
      livreurLastName:        true,
      shippingWorkflowStatus: true,
    },
    orderBy: { deliveryTimeEnd: 'asc' }, // les plus urgentes d'abord : le take ne coupe jamais les retards les plus anciens
    take: 500,
  })

  const now     = Date.now()
  let created   = 0

  for (const order of orders) {
    const deadline   = order.deliveryTimeEnd
    const startTime  = order.dateTimeWhenAssigned ?? order.dateTimeWhenOrderSent
    if (!deadline || !startTime) continue

    const windowMs  = deadline.getTime() - startTime.getTime()
    const elapsedMs = now - startTime.getTime()
    if (windowMs <= 0) continue

    const ratio    = elapsedMs / windowMs
    const elapsedMin = Math.round(elapsedMs / 60000)

    const driverName = [order.livreurFirstName, order.livreurLastName].filter(Boolean).join(' ') || undefined

    if (ratio >= STANDARD_THRESHOLDS.CRITICAL) {
      if (await createDeliveryAlert({
        orderId:    order.id,
        reportId:   report.id,
        driverName,
        mode:       'standard',
        level:      3,
        type:       'delay_confirmed',
        message:    `Retard confirmé — ${elapsedMin}min écoulées, créneau dépassé`,
      })) created++
    } else if (ratio >= STANDARD_THRESHOLDS.DANGER) {
      if (await createDeliveryAlert({
        orderId:    order.id,
        reportId:   report.id,
        driverName,
        mode:       'standard',
        level:      2,
        type:       'delay_risk',
        message:    `Risque retard — ${Math.round(ratio * 100)}% du créneau écoulé (${elapsedMin}min)`,
      })) created++
    } else if (ratio >= STANDARD_THRESHOLDS.WARNING) {
      if (await createDeliveryAlert({
        orderId:    order.id,
        reportId:   report.id,
        driverName,
        mode:       'standard',
        level:      1,
        type:       'delay_risk',
        message:    `Attention — ${Math.round(ratio * 100)}% du créneau écoulé (${elapsedMin}min)`,
      })) created++
    }
  }

  return { checked: orders.length, created }
}

// ── Moteur Express — paliers 45/50/55 min ───────────────────────────────────
// No-op pour l'instant — LiveOrder n'existe pas avant Sprint Express 1
export async function checkExpressDelays(): Promise<{ checked: number; created: number }> {
  return { checked: 0, created: 0 }
}

// ── Alertes prédictives — Score IA < 60 avant départ tournée ────────────────
export async function runPredictiveAlerts(): Promise<{ checked: number; created: number }> {
  // ReliabilityScore = modèle Score IA (voir schema.prisma)
  const lowScores = await prisma.reliabilityScore.findMany({
    where:   { score: { lt: 60 } },
    orderBy: { score: 'asc' },
    take:    10,
  })

  let created = 0
  for (const ds of lowScores) {
    // Déduplication 24h pour les alertes prédictives (pas 30min)
    const recent = await prisma.deliveryAlert.findFirst({
      where: {
        driverName: ds.driverName,
        type:       'predictive',
        triggeredAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    })
    if (recent) continue

    if (await createDeliveryAlert({
      driverName: ds.driverName,
      mode:       'standard',
      level:      1,
      type:       'predictive',
      message:    `Prévision risque retard — Score IA ${Math.round(ds.score)}/100 (${ds.driverName})`,
    })) created++
  }

  return { checked: lowScores.length, created }
}

// ── Chaîne du froid — rupture de température d'un véhicule (lib/ops-cold-chain.ts) ───────────────────────
/**
 * Émet l'alerte d'une rupture (niveau 2 = Slack, niveau 3 = Slack + email). Dédoublonnée par (rupture, niveau) : `key` identifie la rupture
 * (véhicule + capteur + début) et figure dans le message ; la fenêtre de 48 h couvre toute rupture en cours. Retourne true si créée.
 */
export async function emitColdChainAlert(p: { key: string; level: 2 | 3; message: string }): Promise<boolean> {
  const recent = await prisma.deliveryAlert.findFirst({
    where: { type: 'cold_chain', level: p.level, message: { contains: p.key }, triggeredAt: { gte: new Date(Date.now() - 48 * 3_600_000) } },
    select: { id: true },
  })
  if (recent) return false
  return createDeliveryAlert({ mode: 'standard', level: p.level, type: 'cold_chain', message: p.message })
}
