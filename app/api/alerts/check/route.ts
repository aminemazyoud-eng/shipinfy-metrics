import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notify } from '@/lib/notify'

// Checks all enabled alert rules against latest KPIs
// Called by cron (hourly) or manually from the Alertes page
export async function POST() {
  try {
    const rules = await prisma.alertRule.findMany({ where: { enabled: true } })
    if (rules.length === 0) return NextResponse.json({ checked: 0, triggered: 0 })

    // Get the most active report
    const report = await prisma.deliveryReport.findFirst({
      where: { isActive: true },
      orderBy: { uploadedAt: 'desc' },
    })
    if (!report) return NextResponse.json({ checked: 0, triggered: 0, reason: 'no_report' })

    // Fetch all orders for this report
    const orders = await prisma.deliveryOrder.findMany({
      where: { reportId: report.id },
      select: { shippingWorkflowStatus: true, dateTimeWhenDelivered: true, deliveryTimeEnd: true },
    })

    const total = orders.length
    if (total === 0) return NextResponse.json({ checked: 0, triggered: 0, reason: 'no_orders' })

    const delivered  = orders.filter(o => o.shippingWorkflowStatus === 'DELIVERED').length
    const noShow     = orders.filter(o => o.shippingWorkflowStatus === 'NO_SHOW').length
    const onTime     = orders.filter(o =>
      o.shippingWorkflowStatus === 'DELIVERED' &&
      o.dateTimeWhenDelivered && o.deliveryTimeEnd &&
      o.dateTimeWhenDelivered <= o.deliveryTimeEnd
    ).length

    const metrics: Record<string, number> = {
      delivery_rate: total > 0 ? (delivered / total) * 100 : 0,
      no_show_rate:  total > 0 ? (noShow   / total) * 100 : 0,
      no_show_count: noShow,
      on_time_rate:  delivered > 0 ? (onTime / delivered) * 100 : 0,
    }

    const metricLabels: Record<string, string> = {
      delivery_rate: 'Taux de livraison',
      no_show_rate:  'Taux NO_SHOW',
      no_show_count: 'Nombre NO_SHOW',
      on_time_rate:  'Taux On-Time',
    }

    let triggered = 0
    for (const rule of rules) {
      const val = metrics[rule.metric] ?? 0
      let breached = false
      if (rule.operator === 'lt'  && val < rule.threshold)  breached = true
      if (rule.operator === 'lte' && val <= rule.threshold) breached = true
      if (rule.operator === 'gt'  && val > rule.threshold)  breached = true
      if (rule.operator === 'gte' && val >= rule.threshold) breached = true

      if (breached) {
        // Check if there's already an open alert for this rule in the last 6 hours
        const recent = await prisma.alert.findFirst({
          where: {
            ruleId: rule.id,
            status: { in: ['open', 'in_progress'] },
            createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
          },
        })
        if (!recent) {
          const operatorLabel = rule.operator === 'lt' ? '<' : rule.operator === 'gt' ? '>' : rule.operator === 'lte' ? '≤' : '≥'
          const title       = `${metricLabels[rule.metric] ?? rule.metric} — seuil dépassé`
          const description = `${metricLabels[rule.metric] ?? rule.metric} est à ${val.toFixed(1)}% (seuil : ${operatorLabel} ${rule.threshold}%)`

          await prisma.alert.create({
            data: {
              ruleId:      rule.id,
              type:        'auto',
              severity:    rule.severity,
              title,
              description,
              metricValue: val,
              threshold:   rule.threshold,
            },
          })
          triggered++

          // Sprint 19 — unifie ce système d'alertes (seuils KPI) avec le hub de
          // notifications : critical → Slack + email (si ALERT_EMAIL_TO) ; warning → Slack.
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
            }).catch((e) => console.error('[alerts/check] notify error:', e))
          }
        }
      }
    }

    return NextResponse.json({ checked: rules.length, triggered })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Check failed' }, { status: 500 })
  }
}
