/**
 * lib/cron.ts — Scheduler d'envoi automatique de rapports
 *
 * Utilise node-cron pour exécuter les rapports planifiés stockés en DB.
 * Lancé une seule fois via instrumentation.ts au démarrage du serveur.
 */

import cron from 'node-cron'
// Sprint 17 B5 : UN SEUL PrismaClient (singleton partagé) — plus de `new PrismaClient()` dédié au scheduler
import { prisma } from '@/lib/prisma'
// Sprint 7 — moteur alertes prédictives
import { checkStandardDelays, runPredictiveAlerts } from '@/lib/alert-engine'
// Sprint 17 — notifications centralisées (direct OU n8n) + trace /notifications
import { notify } from '@/lib/notify'
// Sprint 17 B5 : logique appelée DIRECTEMENT (plus de fetch HTTP sans session vers notre propre API)
import { runAlertCheck } from '@/lib/alert-check'
import { calculateScores } from '@/lib/score-ia-engine'
// Sprint 18 : rétention nocturne des tables techniques
import { runRetention } from '@/lib/ops-retention'
// Sprint 17 B6 : fuseau Africa/Casablanca réel (plus de getHours()/setHours() du serveur)
import { localParts, localDay, dayStartUtc, offsetMs, attendanceKeyTz, addDays } from '@/lib/tz'

const db = prisma

// ─── KPI computation (light version for scheduled sends) ────────────────────
async function getKpisForReport(reportId: string) {
  const orders = await db.deliveryOrder.findMany({
    where: { reportId },
    select: {
      shippingWorkflowStatus:    true,
      paymentOnDeliveryAmount:   true,
      deliveryTimeEnd:           true,
      dateTimeWhenOrderSent:     true,
      dateTimeWhenDelivered:     true,
      sprintName:                true,
      livreurFirstName:          true,
      livreurLastName:           true,
      originHubName:             true,
      originHubCity:             true,
    },
  })

  const total     = orders.length
  const delivered = orders.filter(o => o.shippingWorkflowStatus === 'DELIVERED')
  const noShow    = orders.filter(o => o.shippingWorkflowStatus === 'NO_SHOW')
  const cod       = orders.reduce((s, o) => s + (o.paymentOnDeliveryAmount ?? 0), 0)
  const onTime    = delivered.filter(o => o.dateTimeWhenDelivered && o.deliveryTimeEnd && o.dateTimeWhenDelivered <= o.deliveryTimeEnd)

  const deliveryRate = total > 0 ? Math.round((delivered.length / total) * 1000) / 10 : 0
  const onTimeRate   = delivered.length > 0 ? Math.round((onTime.length / delivered.length) * 1000) / 10 : 0

  const daySet = new Set(orders.map(o => (o.dateTimeWhenOrderSent ? localDay(o.dateTimeWhenOrderSent.getTime()) : null)).filter(Boolean))
  const avgOrdersPerDay = daySet.size > 0 ? Math.round((total / daySet.size) * 10) / 10 : 0

  return {
    summary: {
      totalOrders: total,
      delivered: delivered.length,
      noShow: noShow.length,
      deliveryRate,
      onTimeRate,
      totalCOD: cod,
      avgOrdersPerDay,
    },
    timing: null as null,
    byLivreur: [] as Array<{ rank: number; name: string; total: number; delivered: number; noShow: number; deliveryRate: number; onTimeRate: number; avgDuration: number; totalCOD: number }>,
    byHub: [] as Array<{ hubName: string; hubCity: string; total: number; delivered: number; deliveryRate: number; avgDuration: number; totalCOD: number }>,
    byDay: [] as Array<{ date: string; total: number; delivered: number; noShow: number; totalCOD: number; deliveryRate: number }>,
    generatedAt: new Date().toISOString(),
  }
}

// ─── Send one scheduled report ───────────────────────────────────────────────
async function sendScheduledReport(scheduleId: string) {
  const schedule = await db.scheduledReport.findUnique({ where: { id: scheduleId } })
  if (!schedule || !schedule.isActive) return

  const emails: string[] = JSON.parse(schedule.emails)
  if (emails.length === 0) return

  let success = false
  let errorMsg: string | undefined

  try {
    const kpisData = await getKpisForReport(schedule.reportId)

    const { buildEmailText } = await import('./email-template')
    const { generateReportPDF } = await import('./pdf-report')

    const textContent = buildEmailText(kpisData)
    const pdfBuffer   = await generateReportPDF(kpisData)

    const lp     = localParts(Date.now())   // date LOCALE marocaine (et non celle du serveur)
    const [year, mm, day] = lp.day.split('-')
    const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
    const month  = months[Number(mm) - 1]
    const dateStr = `${day}-${mm}-${year}`
    const subject = `📦 Rapport Performance Livraison — ${day} ${month} ${year} | Shipinfy Metrics`
    const pdfFilename = `rapport-livraisons-${dateStr}.pdf`

    // Sprint 17 — passe par notify() : mode direct OU délégation n8n + trace /notifications
    const r = await notify({
      kind:       'report',
      event:      'report_ready',
      title:      subject,
      summary:    `${kpisData.summary.totalOrders} commandes · ${kpisData.summary.deliveryRate}% livrées · planifié (${schedule.frequency})`,
      channels:   ['email', 'slack'],
      recipients: emails,
      reportId:   schedule.reportId,
      pdfFilename,
      pdfBase64:  pdfBuffer.toString('base64'),
      data: {
        totalOrders:  kpisData.summary.totalOrders,
        delivered:    kpisData.summary.delivered,
        deliveryRate: kpisData.summary.deliveryRate,
        scheduleId,
        frequency:    schedule.frequency,
      },
      emailSubject:     subject,
      emailText:        textContent,
      emailAttachments: [{ filename: pdfFilename, content: pdfBuffer, contentType: 'application/pdf' }],
    })

    const emailRes = r.results.find(x => x.channel === 'email')
    success  = r.mode === 'n8n' ? r.status !== 'failed' : (!emailRes || emailRes.status === 'delivered')
    if (!success) errorMsg = emailRes?.error
    console.log(`[cron] Rapport ${r.mode === 'n8n' ? 'délégué à n8n' : (success ? 'envoyé' : 'ÉCHEC')} → ${emails.join(', ')} (schedule: ${scheduleId})`)
  } catch (e) {
    errorMsg = String(e)
    console.error(`[cron] Erreur envoi rapport ${scheduleId}:`, e)
  }

  // Log the send attempt
  await db.emailSendLog.create({
    data: {
      scheduleId,
      success,
      recipients: emails.join(', '),
      error: errorMsg ?? null,
    },
  })
}

// ─── Cron expression builder ─────────────────────────────────────────────────
function buildCronExpression(frequency: string, time: string, dayOfWeek?: number | null, dayOfMonth?: number | null): string {
  const [h, m] = time.split(':')
  const hour   = parseInt(h)
  const minute = parseInt(m)

  if (frequency === 'daily') {
    return `${minute} ${hour} * * *`
  }
  if (frequency === 'weekly' && dayOfWeek != null) {
    return `${minute} ${hour} * * ${dayOfWeek}`
  }
  if (frequency === 'monthly' && dayOfMonth != null) {
    return `${minute} ${hour} ${dayOfMonth} * *`
  }
  // Fallback: daily at the given time
  return `${minute} ${hour} * * *`
}

// ─── Active jobs registry ────────────────────────────────────────────────────
const activeJobs = new Map<string, cron.ScheduledTask>()

async function loadAndScheduleAll() {
  const schedules = await db.scheduledReport.findMany({ where: { isActive: true } })

  for (const schedule of schedules) {
    if (activeJobs.has(schedule.id)) continue // already registered

    const expr = buildCronExpression(schedule.frequency, schedule.time, schedule.dayOfWeek, schedule.dayOfMonth)
    const valid = cron.validate(expr)

    if (!valid) {
      console.warn(`[cron] Expression invalide pour schedule ${schedule.id}: ${expr}`)
      continue
    }

    const task = cron.schedule(expr, () => {
      sendScheduledReport(schedule.id).catch(console.error)
    }, {
      timezone: 'Africa/Casablanca',
    })

    activeJobs.set(schedule.id, task)
    console.log(`[cron] Schedule enregistré: ${schedule.id} → ${expr} (${schedule.frequency})`)
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Appelé par instrumentation.ts au démarrage du serveur.
 * Charge tous les schedules actifs et les planifie via node-cron.
 * Vérifie toutes les minutes si de nouveaux schedules ont été ajoutés.
 */
// ─── Alert check ────────────────────────────────────────────────────────────
// Appel direct de lib/alert-check (la route /api/alerts/check garde sa garde d'authentification pour les appels manuels).
async function runAlertCheckJob() {
  try {
    const d = await runAlertCheck()
    if (d.triggered > 0) console.log(`[cron] Alertes déclenchées: ${d.triggered}`)
  } catch (e) {
    console.error('[cron] Erreur vérification alertes:', e)
  }
}

export function startCronScheduler() {
  console.log('[cron] Démarrage du scheduler d\'envoi automatique...')

  // Load existing schedules
  loadAndScheduleAll().catch(console.error)

  // Check every minute for new schedules added via the API
  cron.schedule('* * * * *', () => {
    loadAndScheduleAll().catch(console.error)
  })

  // Hourly alert check — vérifier les seuils toutes les heures
  cron.schedule('0 * * * *', () => {
    runAlertCheckJob().catch(console.error)
  }, { timezone: 'Africa/Casablanca' })

  // Rétention des tables techniques — chaque nuit à 04:15 (Africa/Casablanca), purge par lots
  cron.schedule('15 4 * * *', async () => {
    try {
      const summary = await runRetention()
      console.log('[cron] Rétention terminée', JSON.stringify(summary))
    } catch (e) {
      console.error('[cron] Rétention en échec:', e)
    }
  }, { timezone: 'Africa/Casablanca' })

  // Score IA recalculation — every day at 02:00
  cron.schedule('0 2 * * *', async () => {
    console.log('[cron] Score IA recalculation starting...')
    try {
      // Appel direct (le fetch HTTP sans session était redirigé vers /login : le recalcul nocturne ne tournait jamais)
      const data = await calculateScores()
      if (!data.ok) console.warn(`[cron] Score IA: ${data.error}`)
      else console.log(`[cron] Score IA done — ${data.calculated} drivers calculated`)
    } catch (e) {
      console.error('[cron] Score IA recalculation failed:', e)
    }
  }, { timezone: 'Africa/Casablanca' })

  // Sprint 7 — Alertes retards Standard toutes les 5 min (décalé à la minute 1 pour ne pas coïncider avec sync / incidents)
  cron.schedule('1-59/5 * * * *', async () => {
    try {
      const r = await checkStandardDelays()
      if (r.created > 0) console.log(`[cron] Alertes retards: ${r.created} créées (${r.checked} commandes vérifiées)`)
    } catch (e) {
      console.error('[cron] checkStandardDelays:', e)
    }
  }, { timezone: 'Africa/Casablanca' })

  // Module 0 — Synchro back-office -> OpsOrder toutes les 5 min (opt-in : OPS_SYNC_ENABLED=true)
  if (process.env.OPS_SYNC_ENABLED === 'true') {
    cron.schedule('2-59/5 * * * *', async () => {
      try {
        const { runOpsSync } = await import('@/lib/ops-sync')
        const r = await runOpsSync()
        if (!r.ok) console.warn('[cron] ops-sync:', r.error)
        else if (r.fetched > 0) console.log(`[cron] ops-sync: ${r.fetched} reçues, ${r.created} créées, ${r.updated} MAJ, ${r.events} évts (${r.durationMs}ms)`)
      } catch (e) {
        console.error('[cron] ops-sync:', e)
      }
    }, { timezone: 'Africa/Casablanca' })
    console.log('[cron] ops-sync activé (2-59/5 min)')
  }

  // Incidents terrain : créneaux à risque, retards, NO_SHOW, saturation, documents (opt-in : OPS_ALERTS_ENABLED=true)
  if (process.env.OPS_ALERTS_ENABLED === 'true') {
    cron.schedule('3-59/5 * * * *', async () => {
      try {
        const { runIncidentChecks, retryFailedNotifs } = await import('@/lib/ops-notify')
        const r = await runIncidentChecks()
        if (r.sent || r.failed) console.log('[cron] incidents: ' + r.sent + ' envoyés, ' + r.failed + ' échecs')
        // rejoue les envois en échec (3 tentatives : 1 / 5 / 15 min), puis dead
        const rr = await retryFailedNotifs()
        if (rr.retried) console.log('[cron] relances: ' + rr.retried + ' tentées, ' + rr.recovered + ' récupérées, ' + rr.dead + ' abandonnées')
      } catch (e) { console.error('[cron] incidents:', e) }
    }, { timezone: 'Africa/Casablanca' })
    console.log('[cron] alertes incidents activées (3-59/5 min)')
  }

  // Sprint 7 — Prévisions prédictives Score IA chaque matin 07:00
  cron.schedule('0 7 * * *', async () => {
    try {
      const r = await runPredictiveAlerts()
      if (r.created > 0) console.log(`[cron] Alertes prédictives: ${r.created} créées (${r.checked} livreurs analysés)`)
    } catch (e) {
      console.error('[cron] runPredictiveAlerts:', e)
    }
  }, { timezone: 'Africa/Casablanca' })

  // Sprint 16 — Rappel WhatsApp shift non ouvert toutes les 15 min.
  // Sprint 17 B5 : fenêtre 0 < diffMin <= 15 (chaque shift n'est « due » qu'à UN passage), heures LOCALES via lib/tz.ts,
  // et clé de dédup `shift:<id>:<jour>` dans OpsNotifLog (clé unique) : jamais deux rappels pour le même shift.
  cron.schedule('*/15 * * * *', async () => {
    try {
      const WINDOW_MIN = 15
      const now  = Date.now()
      const today = localDay(now)
      const dayKeyFrom = attendanceKeyTz(today)              // les dates de shift / pointage sont des minuits UTC du jour local
      const dayKeyTo   = attendanceKeyTz(addDays(today, 1))

      const assignments = await db.shiftAssignment.findMany({
        where: { slot: { date: { gte: dayKeyFrom, lt: dayKeyTo } } },
        include: { slot: true },
      })
      if (assignments.length === 0) return

      // Livreurs déjà pointés aujourd'hui (checkIn non null)
      const attendance = await db.driverAttendance.findMany({
        where: { date: { gte: dayKeyFrom, lt: dayKeyTo }, checkIn: { not: null } },
        select: { driverName: true },
      })
      const checkedIn = new Set(attendance.map(a => a.driverName))

      // Instant UTC réel d'une heure locale « HH:MM » du jour local (corrige l'éventuelle bascule Ramadan)
      const startMsOf = (a: (typeof assignments)[number]) => {
        const [h, m] = (a.slot.startTime ?? '00:00').split(':').map(Number)
        const base = dayStartUtc(a.slot.date.toISOString().slice(0, 10))
        const guess = base + ((h || 0) * 60 + (m || 0)) * 60_000
        return guess - (offsetMs(guess) - offsetMs(base))
      }

      // Cible : le slot commence dans (0, 15] minutes ET pas de check-in
      const due = assignments.filter(a => {
        if (checkedIn.has(a.driverName)) return false
        const diffMin = (startMsOf(a) - now) / 60000
        return diffMin > 0 && diffMin <= WINDOW_MIN
      })
      if (due.length === 0) return

      const { sendWhatsApp } = await import('@/lib/whatsapp')
      const { normalizePhone } = await import('@/lib/ops-planning')
      const drivers = await db.driver.findMany({ select: { firstName: true, lastName: true, phone: true } })
      const phoneMap = new Map(drivers.map(d => [`${d.firstName} ${d.lastName}`.trim(), d.phone]))

      const seen = new Set<string>()
      let sent = 0
      for (const a of due) {
        if (seen.has(a.driverName)) continue
        seen.add(a.driverName)

        const startTime = a.slot.startTime
        const phone = normalizePhone(phoneMap.get(a.driverName))
        const message = `⚠️ Rappel : votre shift commence à ${startTime}. Pointez-vous sur l'appli.`

        // Réservation atomique de la clé de dédup AVANT l'envoi : si la ligne existe déjà, le rappel a déjà été traité.
        const dedupeKey = `shift:${a.id}:${today}`
        try {
          await db.opsNotifLog.create({ data: { event: 'shift_reminder', audience: 'chauffeur', channel: 'whatsapp', dedupeKey, recipient: phone, message, ok: false, attempts: phone ? 1 : 0, dead: !phone, error: phone ? null : 'Pas de numéro WhatsApp valide' } })
        } catch { continue } // déjà rappelé
        if (phone) {
          const ok = await sendWhatsApp(phone, message).catch(e => { console.error('[cron] shift reminder whatsapp:', e); return false })
          // pas de rejeu : un rappel tardif (après l'heure de début) n'a plus de sens
          await db.opsNotifLog.update({ where: { dedupeKey }, data: { ok, dead: !ok, error: ok ? null : 'Envoi WhatsApp refusé' } }).catch(() => {})
          if (ok) sent++
        }

        await db.deliveryAlert.create({
          data: {
            driverName: a.driverName,
            mode:    'standard',
            level:   1,
            type:    'predictive',
            message: `Shift non ouvert — ${a.driverName} commence à ${startTime}`,
            channel: 'inapp',
          },
        }).catch(e => console.error('[cron] shift reminder alert:', e))
      }
      console.log(`[cron] Rappels shift traités: ${seen.size} (WhatsApp envoyés: ${sent})`)
    } catch (e) {
      console.error('[cron] shift reminder job:', e)
    }
  }, { timezone: 'Africa/Casablanca' })

  console.log('[cron] Scheduler actif (rapports + alertes + score IA + prédictif).')
}

/**
 * Enregistre immédiatement un nouveau schedule après création via l'API.
 * Permet d'activer le cron sans redémarrer le serveur.
 */
export function registerSchedule(scheduleId: string, frequency: string, time: string, dayOfWeek?: number | null, dayOfMonth?: number | null) {
  if (activeJobs.has(scheduleId)) return

  const expr = buildCronExpression(frequency, time, dayOfWeek, dayOfMonth)
  if (!cron.validate(expr)) {
    console.warn(`[cron] Expression invalide: ${expr}`)
    return
  }

  const task = cron.schedule(expr, () => {
    sendScheduledReport(scheduleId).catch(console.error)
  }, {
    timezone: 'Africa/Casablanca',
  })

  activeJobs.set(scheduleId, task)
  console.log(`[cron] Nouveau schedule enregistré: ${scheduleId} → ${expr}`)
}

/**
 * Désactive un schedule (appelé si l'utilisateur le supprime).
 */
export function unregisterSchedule(scheduleId: string) {
  const task = activeJobs.get(scheduleId)
  if (task) {
    task.stop()
    activeJobs.delete(scheduleId)
    console.log(`[cron] Schedule désactivé: ${scheduleId}`)
  }
}
