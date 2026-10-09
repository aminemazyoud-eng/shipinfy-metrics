/**
 * lib/alert-check.ts — vérification des règles d'alerte KPI — Sprint 17 B5.
 * Logique extraite de app/api/alerts/check/route.ts : appelée par la route (qui garde sa garde d'authentification)
 * ET directement par le cron horaire (plus de fetch HTTP sans session).
 */
import { prisma } from '@/lib/prisma'
import { notify } from '@/lib/notify'

export interface AlertCheckResult { checked: number; triggered: number; reason?: string }

const metricLabels: Record<string, string> = {
  delivery_rate: 'Taux de livraison',
  no_show_rate:  'Taux NO_SHOW',
  no_show_count: 'Nombre NO_SHOW',
  on_time_rate:  'Taux On-Time',
}

/** Évalue toutes les règles activées sur les derniers KPI du rapport actif ; crée les alertes (anti-doublon 6 h) et notifie. */
export async function runAlertCheck(): Promise<AlertCheckResult> {
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } })
  if (rules.length === 0) return { checked: 0, triggered: 0 }

  const report = await prisma.deliveryReport.findFirst({ where: { isActive: true }, orderBy: { uploadedAt: 'desc' } })
  if (!report) return { checked: 0, triggered: 0, reason: 'no_report' }

  const orders = await prisma.deliveryOrder.findMany({
    where: { reportId: report.id },
    select: { shippingWorkflowStatus: true, dateTimeWhenDelivered: true, deliveryTimeEnd: true },
  })
  const total = orders.length
  if (total === 0) return { checked: 0, triggered: 0, reason: 'no_orders' }

  const delivered = orders.filter(o => o.shippingWorkflowStatus === 'DELIVERED').length
  const noShow    = orders.filter(o => o.shippingWorkflowStatus === 'NO_SHOW').length
  const onTime    = orders.filter(o =>
    o.shippingWorkflowStatus === 'DELIVERED' &&
    o.dateTimeWhenDelivered && o.deliveryTimeEnd &&
    o.dateTimeWhenDelivered <= o.deliveryTimeEnd,
  ).length

  const metrics: Record<string, number> = {
    delivery_rate: total > 0 ? (delivered / total) * 100 : 0,
    no_show_rate:  total > 0 ? (noShow   / total) * 100 : 0,
    no_show_count: noShow,
    on_time_rate:  delivered > 0 ? (onTime / delivered) * 100 : 0,
  }

  let triggered = 0
  for (const rule of rules) {
    const val = metrics[rule.metric] ?? 0
    let breached = false
    if (rule.operator === 'lt'  && val < rule.threshold)  breached = true
    if (rule.operator === 'lte' && val <= rule.threshold) breached = true
    if (rule.operator === 'gt'  && val > rule.threshold)  breached = true
    if (rule.operator === 'gte' && val >= rule.threshold) breached = true
    if (!breached) continue

    // Une alerte ouverte pour cette règle dans les 6 dernières heures ? alors rien de neuf.
    const recent = await prisma.alert.findFirst({
      where: { ruleId: rule.id, status: { in: ['open', 'in_progress'] }, createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
    })
    if (recent) continue

    const operatorLabel = rule.operator === 'lt' ? '<' : rule.operator === 'gt' ? '>' : rule.operator === 'lte' ? '≤' : '≥'
    const title       = `${metricLabels[rule.metric] ?? rule.metric} — seuil dépassé`
    const description = `${metricLabels[rule.metric] ?? rule.metric} est à ${val.toFixed(1)}% (seuil : ${operatorLabel} ${rule.threshold}%)`

    await prisma.alert.create({
      data: { ruleId: rule.id, type: 'auto', severity: rule.severity, title, description, metricValue: val, threshold: rule.threshold },
    })
    triggered++

    // critical → Slack + email (si ALERT_EMAIL_TO) ; warning → Slack.
    if (rule.severity === 'critical' || rule.severity === 'warning') {
      const channels: ('email' | 'slack')[] = ['slack']
      const alertEmail = process.env.ALERT_EMAIL_TO?.split(',').map(s => s.trim()).filter(Boolean)
      if (rule.severity === 'critical' && alertEmail?.length) channels.push('email')

      notify({
        kind:       'alert',
        event:      'alert_critical',
        title:      `${rule.severity === 'critical' ? '🔴 [CRITIQUE]' : '🟠 [ALERTE]'} ${title}`,
        summary:    description,
        channels,
        recipients: channels.includes('email') ? alertEmail : undefined,
        alertLevel: rule.severity === 'critical' ? 3 : 2,
        data:       { rule: rule.metric, value: val, threshold: rule.threshold },
      }).catch((e) => console.error('[alert-check] notify error:', e))
    }
  }

  return { checked: rules.length, triggered }
}
