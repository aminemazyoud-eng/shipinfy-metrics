import { NextResponse } from 'next/server'
import { buildEmailText, type EmailKpisData } from '@/lib/email-template'
import { generateReportPDF } from '@/lib/pdf-report'
import { notify } from '@/lib/notify'

export const runtime = 'nodejs'

const MONTHS_FR = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre',
]

function buildSubject(iso: string): string {
  const d = new Date(iso)
  const day   = d.getDate().toString().padStart(2, '0')
  const month = MONTHS_FR[d.getMonth()]
  const year  = d.getFullYear()
  return `📦 Rapport Performance Livraison — ${day} ${month} ${year} | Shipinfy Metrics`
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      reportId:  string
      emails?:   string[]
      email?:    string
      mode?:     string
      filters:   Record<string, unknown>
      kpisData:  EmailKpisData & {
        totalOrders:     number
        delivered:       number
        noShow:          number
        deliveryRate:    number
        onTimeRate:      number
        totalCOD:        number
        avgOrdersPerDay: number
        timing?:         EmailKpisData['timing']
        byLivreur:       EmailKpisData['byLivreur']
        byHub:           EmailKpisData['byHub']
        byDay:           EmailKpisData['byDay']
        byCreneau?:      EmailKpisData['byCreneau']
        statusDistribution?:  EmailKpisData['statusDistribution']
        onTimeDistribution?:  EmailKpisData['onTimeDistribution']
        bestDay?:        EmailKpisData['bestDay']
        worstDay?:       EmailKpisData['worstDay']
      }
    }

    const emails = body.emails ?? (body.email ? [body.email] : [])
    if (emails.length === 0) {
      return NextResponse.json({ error: 'No recipients provided' }, { status: 400 })
    }

    // Guard: refuse to send an empty report (no data imported yet)
    if (!body.kpisData || (body.kpisData.totalOrders ?? 0) === 0) {
      return NextResponse.json(
        { error: 'Aucune donnée disponible. Importez un fichier CSV avant d\'envoyer le rapport.' },
        { status: 422 }
      )
    }

    const generatedAt = new Date().toISOString()

    const emailData: EmailKpisData = {
      summary: {
        totalOrders:     body.kpisData.totalOrders,
        delivered:       body.kpisData.delivered,
        noShow:          body.kpisData.noShow,
        deliveryRate:    body.kpisData.deliveryRate,
        onTimeRate:      body.kpisData.onTimeRate,
        totalCOD:        body.kpisData.totalCOD,
        avgOrdersPerDay: body.kpisData.avgOrdersPerDay,
      },
      timing:    body.kpisData.timing ?? null,
      byLivreur: (body.kpisData.byLivreur ?? []).slice(0, 25).map((l) => ({
        rank:         l.rank,
        name:         l.name,
        total:        l.total,
        delivered:    l.delivered,
        noShow:       l.noShow,
        deliveryRate: l.deliveryRate,
        onTimeRate:   l.onTimeRate,
        avgDuration:  l.avgDuration,
        totalCOD:     l.totalCOD,
      })),
      byHub: (body.kpisData.byHub ?? []).map((h) => ({
        hubName:      h.hubName,
        hubCity:      h.hubCity,
        total:        h.total,
        delivered:    h.delivered,
        deliveryRate: h.deliveryRate,
        avgDuration:  h.avgDuration,
        totalCOD:     h.totalCOD,
      })),
      byDay: (body.kpisData.byDay ?? []).map((d) => ({
        date:         d.date,
        total:        d.total,
        delivered:    d.delivered,
        noShow:       d.noShow,
        totalCOD:     d.totalCOD,
        deliveryRate: d.deliveryRate,
      })),
      byCreneau:           body.kpisData.byCreneau,
      statusDistribution:  body.kpisData.statusDistribution,
      onTimeDistribution:  body.kpisData.onTimeDistribution,
      bestDay:             body.kpisData.bestDay,
      worstDay:            body.kpisData.worstDay,
      generatedAt,
    }

    const textContent = buildEmailText(emailData)
    const pdfBuffer   = await generateReportPDF(emailData)

    const subject = buildSubject(generatedAt)

    const dateStr = new Date(generatedAt)
      .toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      .replace(/\//g, '-')

    const pdfFilename = `rapport-livraisons-${dateStr}.pdf`

    // Sprint 17 — un seul point d'entrée : notify() gère direct OU délégation n8n,
    // + trace systématique dans NotificationLog (/notifications).
    const r = await notify({
      kind:        'report',
      event:       'report_ready',
      title:       subject,
      summary:     `${body.kpisData.totalOrders} commandes · ${body.kpisData.deliveryRate}% livrées · ${emails.length} destinataire(s)`,
      channels:    ['email', 'slack'],
      recipients:  emails,
      reportId:    body.reportId,
      pdfFilename,
      pdfBase64:   pdfBuffer.toString('base64'),
      data: {
        totalOrders:  body.kpisData.totalOrders,
        delivered:    body.kpisData.delivered,
        deliveryRate: body.kpisData.deliveryRate,
        onTimeRate:   body.kpisData.onTimeRate,
        totalCOD:     body.kpisData.totalCOD,
      },
      emailSubject:     subject,
      emailText:        textContent,
      emailAttachments: [{ filename: pdfFilename, content: pdfBuffer, contentType: 'application/pdf' }],
    })

    // En mode direct : si l'email a échoué → 502. En mode n8n : delivery asynchrone → 202.
    if (r.mode === 'direct') {
      const emailRes = r.results.find(x => x.channel === 'email')
      if (emailRes && emailRes.status === 'failed') {
        return NextResponse.json(
          { error: 'Envoi email échoué', detail: emailRes.error, notificationId: r.notificationId },
          { status: 502 }
        )
      }
      return NextResponse.json({ sent: true, emails, notificationId: r.notificationId, mode: r.mode })
    }

    return NextResponse.json({ queued: true, emails, notificationId: r.notificationId, mode: r.mode }, { status: 202 })
  } catch (e) {
    console.error('[send-report]', e)
    return NextResponse.json({ error: 'Send failed', detail: String(e) }, { status: 500 })
  }
}
