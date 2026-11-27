/**
 * lib/bi-report-send.ts — envoi d'un rapport planifié Control Tower (sections choisies, période relative, magasin optionnel).
 * Appelé par lib/cron.ts (planification) et par POST /api/dashboard/schedule-report/send-now (envoi immédiat).
 * Garde-fou : AUCUN envoi si la période ne contient aucune commande (évite un PDF vide, comme pour les anciens rapports).
 */
import { notify } from '@/lib/notify'
import { loadBiOrders } from '@/lib/ops-bi-data'
import { BI_TABS, type BiTabKey } from '@/lib/bi-tabs'
import { buildBiReport, biReportText, isBiSection, isReportPeriod, periodLabel, periodRange } from '@/lib/bi-report'
import { generateBiReportPDF } from '@/lib/pdf-bi-report'

export interface BiScheduleInput {
  id: string; emails: string[]; frequency: string
  name?: string | null; sections?: string | null; period?: string | null; hub?: string | null
}
export interface SendResult { success: boolean; error?: string }

export function parseSections(raw: string | null | undefined): BiTabKey[] {
  try {
    const arr = JSON.parse(raw ?? '[]') as unknown[]
    const ok = arr.filter(isBiSection)
    return ok.length ? ok : BI_TABS.map(t => t.key)
  } catch { return BI_TABS.map(t => t.key) }
}

export async function sendBiScheduledReport(s: BiScheduleInput, nowMs = Date.now()): Promise<SendResult> {
  const sections = parseSections(s.sections)
  const period = isReportPeriod(s.period) ? s.period : 'yesterday'
  const range = periodRange(period, nowMs)
  const payload = await loadBiOrders(range.from, range.to)
  const report = buildBiReport(payload.rows, sections, { from: range.from, to: range.to, hub: s.hub, source: { name: payload.source, lastSync: payload.lastSync } })
  if (report.totalOrders === 0) {
    return { success: false, error: `Aucune commande sur la période (${range.from === range.to ? range.from : `${range.from} au ${range.to}`}${s.hub ? `, magasin ${s.hub}` : ''}) : rapport non envoyé. Vérifiez la synchronisation du back-office.` }
  }

  const names = report.sections.map(x => x.title)
  const label = s.name?.trim() || (names.length === BI_TABS.length ? 'Rapport Control Tower' : `Rapport · ${names.join(', ')}`)
  const periodText = range.from === range.to ? `Le ${range.from.split('-').reverse().join('/')}` : `Du ${range.from.split('-').reverse().join('/')} au ${range.to.split('-').reverse().join('/')}`
  const subject = `📊 ${label} — ${periodText} | Shipinfy Metrics`
  const pdf = await generateBiReportPDF(report, { title: label, periodText })
  const pdfFilename = `rapport-${range.from}${range.from === range.to ? '' : `_${range.to}`}.pdf`

  const r = await notify({
    kind: 'report', event: 'report_ready', title: subject,
    summary: `${report.totalOrders} commandes · ${names.length} section(s) · ${periodLabel(period)} · planifié (${s.frequency})`,
    channels: ['email'], recipients: s.emails, reportId: `bi:${s.id}`, pdfFilename, pdfBase64: pdf.toString('base64'),
    data: { totalOrders: report.totalOrders, sections: report.sections.map(x => x.key), period, hub: s.hub ?? null, scheduleId: s.id, frequency: s.frequency },
    emailSubject: subject, emailText: biReportText(report, `${label} — ${periodText}`),
    emailAttachments: [{ filename: pdfFilename, content: pdf, contentType: 'application/pdf' }],
  })
  const emailRes = r.results.find(x => x.channel === 'email')
  const success = r.mode === 'n8n' ? r.status !== 'failed' : (!emailRes || emailRes.status === 'delivered')
  return success ? { success: true } : { success: false, error: emailRes?.error ?? 'Envoi email en échec' }
}
