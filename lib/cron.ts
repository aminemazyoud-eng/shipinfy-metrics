/**
 * lib/cron.ts — Scheduler d'envoi automatique de rapports
 *
 * Utilise node-cron pour exécuter les rapports planifiés stockés en DB.
 * Lancé une seule fois via instrumentation.ts au démarrage du serveur.
 */

import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import nodemailer from 'nodemailer'

// Prisma client dédié au scheduler (pas le singleton global)
const db = new PrismaClient()

const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   ?? 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT ?? '465'),
  secure: (process.env.SMTP_PORT ?? '465') === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

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

  const daySet = new Set(orders.map(o => o.dateTimeWhenOrderSent?.toISOString().slice(0, 10)).filter(Boolean))
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

    const now    = new Date()
    const day    = now.getDate().toString().padStart(2, '0')
    const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
    const month  = months[now.getMonth()]
    const year   = now.getFullYear()
    const dateStr = `${day.padStart(2, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${year}`

    await mailer.sendMail({
      from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to:      emails.join(', '),
      subject: `📦 Rapport Performance Livraison — ${day} ${month} ${year} | Shipinfy Metrics`,
      text:    textContent,
      attachments: [{
        filename:    `rapport-livraisons-${dateStr}.pdf`,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      }],
    })

    success = true
    console.log(`[cron] Rapport envoyé → ${emails.join(', ')} (schedule: ${scheduleId})`)
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
async function runAlertCheck() {
  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:${process.env.PORT ?? 3001}`
    const res = await fetch(`${baseUrl}/api/alerts/check`, { method: 'POST' })
    if (res.ok) {
      const d = await res.json() as { triggered?: number }
      if ((d.triggered ?? 0) > 0) {
        console.log(`[cron] Alertes déclenchées: ${d.triggered}`)
      }
    }
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
    runAlertCheck().catch(console.error)
  }, { timezone: 'Africa/Casablanca' })

  console.log('[cron] Scheduler actif (rapports + alertes).')
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
