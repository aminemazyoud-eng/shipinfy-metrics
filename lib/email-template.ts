export interface EmailKpisData {
  summary: {
    totalOrders: number
    delivered: number
    noShow: number
    deliveryRate: number
    onTimeRate: number
    totalCOD: number
    avgOrdersPerDay: number
  }
  timing: {
    orderToAssign: number
    assignToTransport: number
    transportToStart: number
    startToDelivered: number
    totalDuration: number
  } | null
  byLivreur: Array<{
    rank: number
    name: string
    total: number
    delivered: number
    noShow: number
    deliveryRate: number
    onTimeRate: number
    avgDuration: number
    totalCOD: number
  }>
  byHub: Array<{
    hubName: string
    hubCity: string
    total: number
    delivered: number
    deliveryRate: number
    avgDuration: number
    totalCOD: number
  }>
  byDay: Array<{
    date: string
    total: number
    delivered: number
    noShow: number
    totalCOD: number
    deliveryRate: number
  }>
  byCreneau?: Array<{
    creneau: string
    total: number
    delivered: number
    noShow: number
    deliveryRate: number
    onTimeRate: number
    avgDuration: number
  }>
  statusDistribution?: Array<{ name: string; value: number; color: string }>
  onTimeDistribution?: Array<{ name: string; value: number; color: string }>
  bestDay?: { date: string; volume: number; avgDuration: number } | null
  worstDay?: { date: string; volume: number; avgDuration: number } | null
  generatedAt: string
}

// ─── Formatters ────────────────────────────────────────────────────────────────
const fmt = (n: number): string =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F')

const fmtPct = (n: number): string => `${n.toFixed(1).replace('.', ',')} %`

const fmtMAD = (n: number): string => `${fmt(n)} MAD`

const fmtMin = (n: number): string => {
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`
}

const fmtDateLong = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

const rateColor = (rate: number): string =>
  rate >= 80 ? '#16a34a' : rate >= 60 ? '#d97706' : '#dc2626'

const rateEmoji = (rate: number): string => (rate >= 80 ? '🟢' : rate >= 60 ? '🟡' : '🔴')

function getPeriod(byDay: EmailKpisData['byDay']): string {
  if (!byDay.length) return ''
  const sorted = [...byDay].map(d => d.date).sort()
  const from = sorted[0]
  const to   = sorted[sorted.length - 1]
  if (from === to) return `du ${from}`
  return `du ${from} au ${to}`
}

export function buildEmailText(data: EmailKpisData): string {
  const { summary, timing, byLivreur, byHub, byDay } = data
  const period  = getPeriod(byDay)
  const medals  = ['🥇', '🥈', '🥉']
  const top3    = byLivreur.slice(0, 3)

  const kpiLines = [
    `• Taux de livraison   → ${fmtPct(summary.deliveryRate)}`,
    `• Taux on-time        → ${fmtPct(summary.onTimeRate)}`,
    `• Total commandes     → ${fmt(summary.totalOrders)}`,
    `• COD total           → ${fmtMAD(summary.totalCOD)}`,
    timing ? `• Durée totale moy.   → ${fmtMin(timing.totalDuration)}` : null,
  ].filter(Boolean).join('\n')

  const livreurLines = top3.map((l, i) => {
    const nameP = l.name.padEnd(20)
    return `${medals[i]} ${nameP} — ${l.deliveryRate.toFixed(0)} % | ${fmtMAD(l.totalCOD)}`
  }).join('\n')

  const hubLines = byHub.map(h => {
    const icon = h.deliveryRate >= 80 ? '✅' : '⚠️'
    const nameP = h.hubName.padEnd(25)
    const alert = h.deliveryRate < 80 ? ' → Action requise' : ''
    return `${icon} ${nameP} — ${fmtPct(h.deliveryRate)}${alert}`
  }).join('\n')

  return [
    'Bonjour,',
    '',
    `Voici le résumé des performances de livraison${period ? ` pour la période ${period}` : ''}.`,
    '',
    '📊 KPIs CLÉS',
    kpiLines,
    '',
    top3.length > 0 ? '🏆 TOP 3 LIVREURS\n' + livreurLines : null,
    '',
    byHub.length > 0 ? '🏭 HUBS\n' + hubLines : null,
    '',
    'Le rapport complet est joint en PDF.',
    '',
    'Cordialement,',
    "L'équipe Operations — Shipinfy Metrics",
    'metrics.mediflows.shop',
  ].filter(l => l !== null).join('\n')
}

function kpiCard(emoji: string, value: string, label: string, color = '#1d4ed8') {
  return `<td width="145" style="padding:6px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"
      style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:10px;">
      <tr><td style="padding:14px 10px;text-align:center;">
        <div style="font-size:22px;margin-bottom:4px;">${emoji}</div>
        <div style="font-size:19px;font-weight:800;color:${color};font-family:Arial,sans-serif;line-height:1.2;">${value}</div>
        <div style="font-size:10px;color:#64748b;font-family:Arial,sans-serif;margin-top:4px;text-transform:uppercase;letter-spacing:0.3px;">${label}</div>
      </td></tr>
    </table>
  </td>`
}

function pipelineStep(label: string, value: string, isLast = false) {
  return `<td style="text-align:center;vertical-align:top;padding:0 2px;">
    <div style="width:52px;height:52px;border-radius:50%;background:#dbeafe;border:2.5px solid #2563eb;
      margin:0 auto;font-size:11px;font-weight:800;color:#1d4ed8;font-family:Arial,sans-serif;
      line-height:52px;text-align:center;">${value}</div>
    <div style="font-size:9px;color:#64748b;font-family:Arial,sans-serif;margin-top:6px;max-width:62px;line-height:1.3;">${label}</div>
  </td>${isLast ? '' : `<td style="vertical-align:middle;padding-bottom:22px;">
    <div style="width:18px;height:2px;background:#bfdbfe;margin:0 auto;"></div>
  </td>`}`
}

function sectionHeader(title: string) {
  return `<tr><td style="padding:20px 0 10px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="border-left:4px solid #2563eb;padding-left:12px;">
        <span style="font-size:15px;font-weight:700;color:#0f172a;font-family:Arial,sans-serif;">${title}</span>
      </td>
    </tr></table>
  </td></tr>`
}

function tableHeaderRow(cols: Array<{ label: string; align?: string }>) {
  return `<tr style="background:#1e3a5f;">${cols
    .map(c => `<th style="padding:10px 10px;font-size:10px;font-weight:700;color:#e2e8f0;
        text-align:${c.align ?? 'left'};font-family:Arial,sans-serif;
        text-transform:uppercase;letter-spacing:0.4px;">${c.label}</th>`)
    .join('')}</tr>`
}

export function buildEmailHTML(data: EmailKpisData): string {
  const { summary, timing, byLivreur, byHub, byDay, byCreneau, bestDay, worstDay, generatedAt } = data
  const date    = fmtDateLong(generatedAt)
  const period  = getPeriod(byDay)
  const medals  = ['🥇', '🥈', '🥉']
  const top3    = byLivreur.slice(0, 3)
  const topLiv  = byLivreur.slice(0, 10)
  const topHubs = byHub.slice(0, 8)
  const recDays = [...byDay].slice(-10)

  const introHTML = `
    <tr><td style="padding:0 0 24px;">
      <p style="font-size:15px;font-weight:700;color:#0f172a;font-family:Arial,sans-serif;margin:0 0 8px;">Bonjour,</p>
      <p style="font-size:13px;color:#475569;font-family:Arial,sans-serif;margin:0 0 16px;line-height:1.6;">
        Voici le résumé des performances de livraison${period ? ` <strong>pour la période ${period}</strong>` : ''}.
      </p>

      <table cellpadding="0" cellspacing="0" border="0" width="100%"
        style="background:#f8faff;border-left:4px solid #2563eb;border-radius:0 8px 8px 0;margin-bottom:16px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:12px;font-weight:700;color:#1e3a5f;font-family:Arial,sans-serif;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;">📊 KPIs Clés</div>
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="50%" style="padding:3px 0;">
                <span style="font-size:12px;color:#475569;font-family:Arial,sans-serif;">Taux de livraison</span>
                <span style="font-size:12px;font-weight:700;color:${rateColor(summary.deliveryRate)};font-family:Arial,sans-serif;"> → ${fmtPct(summary.deliveryRate)}</span>
              </td>
              <td width="50%" style="padding:3px 0;">
                <span style="font-size:12px;color:#475569;font-family:Arial,sans-serif;">Taux on-time</span>
                <span style="font-size:12px;font-weight:700;color:${rateColor(summary.onTimeRate)};font-family:Arial,sans-serif;"> → ${fmtPct(summary.onTimeRate)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:3px 0;">
                <span style="font-size:12px;color:#475569;font-family:Arial,sans-serif;">Total commandes</span>
                <span style="font-size:12px;font-weight:700;color:#1d4ed8;font-family:Arial,sans-serif;"> → ${fmt(summary.totalOrders)}</span>
              </td>
              <td style="padding:3px 0;">
                <span style="font-size:12px;color:#475569;font-family:Arial,sans-serif;">COD total</span>
                <span style="font-size:12px;font-weight:700;color:#7c3aed;font-family:Arial,sans-serif;"> → ${fmtMAD(summary.totalCOD)}</span>
              </td>
            </tr>
            ${timing ? `<tr>
              <td style="padding:3px 0;" colspan="2">
                <span style="font-size:12px;color:#475569;font-family:Arial,sans-serif;">Durée totale moy.</span>
                <span style="font-size:12px;font-weight:700;color:#0891b2;font-family:Arial,sans-serif;"> → ${fmtMin(timing.totalDuration)}</span>
              </td>
            </tr>` : ''}
          </table>
        </td></tr>
      </table>

      ${top3.length > 0 ? `<table cellpadding="0" cellspacing="0" border="0" width="100%"
        style="background:#fefce8;border-left:4px solid #d97706;border-radius:0 8px 8px 0;margin-bottom:16px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:12px;font-weight:700;color:#92400e;font-family:Arial,sans-serif;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;">🏆 Top 3 Livreurs</div>
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${top3.map((l, i) => `<tr>
              <td style="padding:3px 0;font-size:12px;font-family:Arial,sans-serif;color:#0f172a;">
                ${medals[i]} <strong>${l.name}</strong>
                <span style="color:${rateColor(l.deliveryRate)};font-weight:700;"> ${l.deliveryRate.toFixed(0)} %</span>
                <span style="color:#64748b;"> | </span>
                <span style="color:#7c3aed;font-weight:600;">${fmtMAD(l.totalCOD)}</span>
              </td>
            </tr>`).join('')}
          </table>
        </td></tr>
      </table>` : ''}

      ${topHubs.length > 0 ? `<table cellpadding="0" cellspacing="0" border="0" width="100%"
        style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:0 8px 8px 0;margin-bottom:8px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:12px;font-weight:700;color:#14532d;font-family:Arial,sans-serif;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;">🏭 Performance par Hub</div>
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${topHubs.map(h => `<tr>
              <td style="padding:3px 0;font-size:12px;font-family:Arial,sans-serif;color:#0f172a;">
                ${rateEmoji(h.deliveryRate)} <strong>${h.hubName}</strong>
                <span style="color:${rateColor(h.deliveryRate)};font-weight:700;"> — ${fmtPct(h.deliveryRate)}</span>
                ${h.deliveryRate < 80 ? `<span style="color:#dc2626;font-size:10px;font-style:italic;"> → Action requise</span>` : ''}
              </td>
            </tr>`).join('')}
          </table>
        </td></tr>
      </table>` : ''}

      <p style="font-size:12px;color:#94a3b8;font-family:Arial,sans-serif;margin:12px 0 0;font-style:italic;">
        Le rapport complet est joint en pièce jointe PDF.
      </p>
    </td></tr>

    <tr><td style="padding:0 0 8px;">
      <div style="height:1px;background:#e2e8f0;"></div>
      <div style="text-align:center;margin-top:-9px;">
        <span style="background:#ffffff;padding:0 12px;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;">Rapport détaillé</span>
      </div>
    </td></tr>`

  const livreurRows = topLiv.map((l, i) =>
    `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8faff'};">
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;color:#1e3a5f;font-weight:700;">#${l.rank}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;color:#0f172a;font-weight:500;">${l.name}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;">${fmt(l.total)}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;color:#16a34a;text-align:right;font-weight:600;">${fmt(l.delivered)}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;">
        ${rateEmoji(l.deliveryRate)} <span style="color:${rateColor(l.deliveryRate)};font-weight:700;">${fmtPct(l.deliveryRate)}</span>
      </td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;color:#475569;">${fmtMin(l.avgDuration)}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;color:#7c3aed;font-weight:600;">${fmtMAD(l.totalCOD)}</td>
    </tr>`
  ).join('')

  const hubRows = topHubs.map((h, i) =>
    `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8faff'};">
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;color:#0f172a;font-weight:500;">${h.hubName}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;color:#64748b;">${h.hubCity || '—'}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;">${fmt(h.total)}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;">
        ${rateEmoji(h.deliveryRate)} <span style="color:${rateColor(h.deliveryRate)};font-weight:700;">${fmtPct(h.deliveryRate)}</span>
      </td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;color:#475569;">${fmtMin(h.avgDuration)}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;color:#7c3aed;font-weight:600;">${fmtMAD(h.totalCOD)}</td>
    </tr>`
  ).join('')

  const dayRows = recDays.map((d, i) =>
    `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8faff'};">
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;color:#0f172a;">${d.date}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;">${fmt(d.total)}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;color:#16a34a;text-align:right;font-weight:600;">${fmt(d.delivered)}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;color:#dc2626;text-align:right;">${fmt(d.noShow)}</td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;">
        <span style="color:${rateColor(d.deliveryRate)};font-weight:700;">${fmtPct(d.deliveryRate)}</span>
      </td>
      <td style="padding:9px 10px;font-size:12px;font-family:Arial;text-align:right;color:#7c3aed;">${fmtMAD(d.totalCOD)}</td>
    </tr>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Rapport Performance Livraison — Shipinfy Metrics</title>
</head>
<body style="margin:0;padding:0;background:#e2e8f0;font-family:Arial,sans-serif;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#e2e8f0;padding:28px 0;">
<tr><td align="center">

  <table cellpadding="0" cellspacing="0" border="0" width="620"
    style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.10);">

    <tr><td style="padding:0;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="background:#1e3a5f;padding:28px 36px 24px;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td>
                  <div style="font-size:24px;font-weight:900;color:#ffffff;font-family:Arial,sans-serif;letter-spacing:-0.5px;">📊 SHIPINFY METRICS</div>
                  <div style="font-size:12px;color:#93c5fd;font-family:Arial,sans-serif;margin-top:3px;letter-spacing:0.5px;">RAPPORT PERFORMANCE LIVRAISON</div>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <div style="background:#2563eb;border-radius:8px;padding:10px 16px;display:inline-block;">
                    <div style="font-size:11px;color:#bfdbfe;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.5px;">Généré le</div>
                    <div style="font-size:15px;font-weight:700;color:#ffffff;font-family:Arial,sans-serif;margin-top:2px;">${date}</div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td style="height:4px;background:linear-gradient(90deg,#2563eb,#7c3aed,#2563eb);"></td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:28px 36px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">

        ${introHTML}

        <tr><td>
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              ${kpiCard('📦', fmt(summary.totalOrders), 'Total commandes', '#1d4ed8')}
              ${kpiCard('✅', fmtPct(summary.deliveryRate), 'Taux livraison', rateColor(summary.deliveryRate))}
              ${kpiCard('⏱', fmtPct(summary.onTimeRate), 'On-Time', rateColor(summary.onTimeRate))}
              ${kpiCard('💰', fmtMAD(summary.totalCOD), 'Total COD', '#7c3aed')}
            </tr>
            <tr>
              ${kpiCard('✔️', fmt(summary.delivered), 'Livrées', '#16a34a')}
              ${kpiCard('✕', fmt(summary.noShow), 'NO_SHOW', '#dc2626')}
              ${kpiCard('📅', summary.avgOrdersPerDay.toFixed(0), 'Cmd / jour', '#0891b2')}
              ${kpiCard('💵', fmtMAD(summary.totalCOD / Math.max(summary.delivered, 1)), 'Moy. COD/cmd', '#7c3aed')}
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:8px 0;"><div style="height:1px;background:#e2e8f0;"></div></td></tr>

        ${timing ? `
        ${sectionHeader('⏱ Pipeline des délais')}
        <tr><td style="padding-bottom:8px;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
            <tr>
              ${pipelineStep('Création → Assigné', fmtMin(timing.orderToAssign))}
              ${pipelineStep('Assigné → Transport', fmtMin(timing.assignToTransport))}
              ${pipelineStep('Transport → Départ', fmtMin(timing.transportToStart))}
              ${pipelineStep('Départ → Livré', fmtMin(timing.startToDelivered))}
              ${pipelineStep('Total', fmtMin(timing.totalDuration), true)}
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:8px 0;"><div style="height:1px;background:#e2e8f0;"></div></td></tr>` : ''}

        ${topLiv.length > 0 ? `
        ${sectionHeader('🏆 Classement Livreurs')}
        <tr><td>
          <table cellpadding="0" cellspacing="0" border="0" width="100%"
            style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
            ${tableHeaderRow([
              { label: 'Rang' },
              { label: 'Livreur' },
              { label: 'Total',    align: 'right' },
              { label: 'Livrées', align: 'right' },
              { label: 'Taux',    align: 'right' },
              { label: 'Durée',   align: 'right' },
              { label: 'COD',     align: 'right' },
            ])}
            ${livreurRows}
          </table>
        </td></tr>
        <tr><td style="padding:8px 0;"><div style="height:1px;background:#e2e8f0;"></div></td></tr>` : ''}

        ${topHubs.length > 0 ? `
        ${sectionHeader('🏭 Performance par Hub')}
        <tr><td>
          <table cellpadding="0" cellspacing="0" border="0" width="100%"
            style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
            ${tableHeaderRow([
              { label: 'Hub' },
              { label: 'Ville' },
              { label: 'Total',    align: 'right' },
              { label: 'Taux',     align: 'right' },
              { label: 'Durée',    align: 'right' },
              { label: 'COD',      align: 'right' },
            ])}
            ${hubRows}
          </table>
        </td></tr>
        <tr><td style="padding:8px 0;"><div style="height:1px;background:#e2e8f0;"></div></td></tr>` : ''}

        ${recDays.length > 0 ? `
        ${sectionHeader('📅 Tendance journalière')}
        <tr><td>
          <table cellpadding="0" cellspacing="0" border="0" width="100%"
            style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
            ${tableHeaderRow([
              { label: 'Date' },
              { label: 'Total',    align: 'right' },
              { label: 'Livrées', align: 'right' },
              { label: 'NO_SHOW', align: 'right' },
              { label: 'Taux',    align: 'right' },
              { label: 'COD',     align: 'right' },
            ])}
            ${dayRows}
          </table>
        </td></tr>` : ''}

        <tr><td style="padding:28px 0 16px;text-align:center;">
          <a href="https://metrics.mediflows.shop"
            style="background:#2563eb;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;
              font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;
              display:inline-block;letter-spacing:0.3px;">
            📊 Voir le Dashboard Complet
          </a>
        </td></tr>

        <tr><td style="border-top:1px solid #f1f5f9;padding-top:16px;text-align:center;">
          <p style="font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;margin:0;line-height:1.6;">
            Ce rapport a été généré automatiquement par <strong style="color:#64748b;">Shipinfy Metrics</strong> le ${date}.<br>
            Pour toute question, contactez votre administrateur.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>

  <table cellpadding="0" cellspacing="0" border="0" width="620" style="margin-top:14px;">
    <tr><td style="text-align:center;">
      <p style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;margin:0;">
        © ${new Date().getFullYear()} Shipinfy Metrics · metrics.mediflows.shop
      </p>
    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`
}
