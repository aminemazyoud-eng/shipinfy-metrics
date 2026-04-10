import type { EmailKpisData } from './email-template'

type PDFKit = typeof import('pdfkit')
type PDFDocument = InstanceType<PDFKit>

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmt    = (n: number): string =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const fmtPct = (n: number): string => `${n.toFixed(1)} %`
const fmtMAD = (n: number): string => `${fmt(n)} MAD`
const fmtMin = (n: number): string => {
  const h = Math.floor(n / 60); const m = Math.round(n % 60)
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`
}
const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  navy:     '#0f172a',
  blue:     '#2563eb',
  blueLight:'#dbeafe',
  blueDeep: '#1e3a5f',
  green:    '#16a34a',
  greenLight:'#dcfce7',
  red:      '#dc2626',
  redLight: '#fee2e2',
  orange:   '#ea580c',
  orangeLight:'#fed7aa',
  purple:   '#7c3aed',
  purpleLight:'#ede9fe',
  cyan:     '#0891b2',
  cyanLight:'#cffafe',
  gray:     '#64748b',
  grayLight:'#f1f5f9',
  border:   '#e2e8f0',
  white:    '#ffffff',
  text:     '#0f172a',
  muted:    '#64748b',
}

const PAGE_W    = 595
const PAGE_H    = 842
const M         = 40     // margin
const CW        = PAGE_W - M * 2
const HEADER_H  = 96

function rateColor(r: number) { return r >= 80 ? C.green : r >= 60 ? C.orange : C.red }
function rateLight(r: number) { return r >= 80 ? C.greenLight : r >= 60 ? C.orangeLight : C.redLight }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function drawHeader(doc: PDFDocument, generatedAt: string) {
  // Navy gradient-like background
  doc.rect(0, 0, PAGE_W, HEADER_H).fill(C.navy)

  // Blue accent bar bottom
  doc.rect(0, HEADER_H - 4, PAGE_W, 4).fill(C.blue)

  // Left — logo wordmark
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(24)
     .text('SHIPINFY', M, 22, { lineBreak: false })
  doc.fillColor('#94a3b8').font('Helvetica').fontSize(9)
     .text('METRICS & ANALYTICS', M, 50, { lineBreak: false })
  doc.fillColor('#475569').font('Helvetica').fontSize(7.5)
     .text('metrics.mediflows.shop', M, 63, { lineBreak: false })

  // Center divider
  doc.rect(PAGE_W / 2 - 1, 18, 1, 52).fill('#1e293b')

  // Right — report badge
  const bx = PAGE_W / 2 + 20; const by = 16
  doc.rect(bx, by, CW / 2 - 4, 58).roundedRect(bx, by, CW / 2 - 4, 58, 6).fill('#1e293b')
  doc.fillColor('#94a3b8').font('Helvetica').fontSize(7.5)
     .text('RAPPORT DE PERFORMANCE — LIVRAISONS', bx + 10, by + 10, { lineBreak: false })
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(11)
     .text(fmtDate(generatedAt), bx + 10, by + 24, { lineBreak: false })
  doc.fillColor('#3b82f6').font('Helvetica').fontSize(8)
     .text('Généré automatiquement par Shipinfy Metrics', bx + 10, by + 42, { lineBreak: false })
}

function drawFooter(doc: PDFDocument, page: number, total: number) {
  const fy = PAGE_H - 28
  doc.rect(0, fy - 1, PAGE_W, 1).fill(C.border)
  doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
     .text('© Shipinfy Metrics · Confidentiel', M, fy + 8, { lineBreak: false })
  doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(7.5)
     .text(`Page ${page} / ${total}`, 0, fy + 8, { align: 'right', width: PAGE_W - M, lineBreak: false })
}

function sectionTitle(doc: PDFDocument, title: string, emoji: string, y: number): number {
  // Colored pill background
  doc.rect(M, y, CW, 26).roundedRect(M, y, CW, 26, 4).fill(C.grayLight)
  doc.rect(M, y, 4, 26).fill(C.blue)
  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(11)
     .text(`${emoji}  ${title}`, M + 14, y + 7, { lineBreak: false })
  return y + 36
}

// Premium KPI card with icon area + bottom label
function kpiCard(
  doc: PDFDocument,
  x: number, y: number, w: number, h: number,
  label: string, value: string,
  accent: string, bg: string,
  badge?: string
) {
  // Shadow effect (light gray offset)
  doc.rect(x + 2, y + 2, w, h).roundedRect(x + 2, y + 2, w, h, 6).fill('#e2e8f0')
  // Card body
  doc.rect(x, y, w, h).roundedRect(x, y, w, h, 6).fill(bg)
  // Top accent strip
  doc.rect(x, y, w, 3).roundedRect(x, y, w, 3, 6).fill(accent)
  // Value
  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(18)
     .text(value, x + 6, y + 14, { width: w - 12, align: 'center', lineBreak: false })
  // Label
  doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
     .text(label.toUpperCase(), x + 4, y + h - 16, { width: w - 8, align: 'center', lineBreak: false })
  // Optional badge
  if (badge) {
    doc.rect(x + w - 24, y + 9, 18, 12).roundedRect(x + w - 24, y + 9, 18, 12, 3).fill(accent)
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7)
       .text(badge, x + w - 24, y + 12, { width: 18, align: 'center', lineBreak: false })
  }
}

// Rate bar with label
function rateBar(
  doc: PDFDocument,
  x: number, y: number, w: number,
  label: string, rate: number, color: string
) {
  const BAR_H = 8
  doc.fillColor(C.text).font('Helvetica').fontSize(8)
     .text(label, x, y, { width: 130, lineBreak: false })
  const bx = x + 136; const bw = w - 136 - 44
  doc.rect(bx, y, bw, BAR_H).roundedRect(bx, y, bw, BAR_H, 4).fill(C.border)
  const fill = Math.max(6, (Math.min(rate, 100) / 100) * bw)
  doc.rect(bx, y, fill, BAR_H).roundedRect(bx, y, fill, BAR_H, 4).fill(color)
  // Percentage pill
  const pc = rate.toFixed(1) + '%'
  doc.rect(x + w - 40, y - 1, 40, BAR_H + 2).roundedRect(x + w - 40, y - 1, 40, BAR_H + 2, 3).fill(color)
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7.5)
     .text(pc, x + w - 40, y + 1, { width: 40, align: 'center', lineBreak: false })
  return y + BAR_H + 8
}

// Pipeline step circle
function pipeStep(
  doc: PDFDocument,
  cx: number, cy: number, r: number,
  value: string, label: string,
  accent: string, isLast: boolean
) {
  // Circle fill
  doc.circle(cx, cy, r).fill(accent)
  doc.circle(cx, cy, r - 3).fill(C.white)
  // Value
  doc.fillColor(accent).font('Helvetica-Bold').fontSize(9)
     .text(value, cx - r + 4, cy - 8, { width: (r - 4) * 2, align: 'center', lineBreak: false })
  // Label below
  doc.fillColor(C.muted).font('Helvetica').fontSize(7)
     .text(label, cx - 32, cy + r + 4, { width: 64, align: 'center' })
  // Arrow to next
  if (!isLast) {
    const ax = cx + r + 2
    doc.moveTo(ax, cy).lineTo(ax + 14, cy).stroke(C.border)
    doc.moveTo(ax + 14, cy - 4).lineTo(ax + 20, cy).lineTo(ax + 14, cy + 4).fill(C.border)
  }
}

// Table with premium styling
function drawTable(
  doc: PDFDocument,
  headers: string[],
  rows: { cells: string[]; highlight?: boolean; rateIdx?: number }[],
  colW: number[],
  align: ('left' | 'right' | 'center')[],
  y: number
): number {
  const HH = 26; const RH = 20
  const totalW = colW.reduce((s, w) => s + w, 0)

  // Header background
  doc.rect(M, y, totalW, HH).roundedRect(M, y, totalW, HH, 4).fill(C.navy)

  let cx = M
  headers.forEach((h, i) => {
    doc.fillColor('#cbd5e1').font('Helvetica-Bold').fontSize(8)
       .text(h, cx + 5, y + 9, { width: colW[i] - 10, align: align[i] ?? 'left', lineBreak: false })
    cx += colW[i]
  })

  rows.forEach((row, ri) => {
    const ry = y + HH + ri * RH
    const bg = row.highlight ? C.blueLight : ri % 2 === 0 ? C.white : C.grayLight
    doc.rect(M, ry, totalW, RH).fill(bg)

    let cx2 = M
    row.cells.forEach((cell, ci) => {
      // Detect rate cells for colored rendering
      const isRate = (ci === row.rateIdx)
      if (isRate) {
        const r = parseFloat(cell)
        if (!isNaN(r)) {
          const rColor = rateColor(r)
          const rBg    = rateLight(r)
          const tw = colW[ci] - 14
          doc.rect(cx2 + 5, ry + 3, tw, RH - 6).roundedRect(cx2 + 5, ry + 3, tw, RH - 6, 3).fill(rBg)
          doc.fillColor(rColor).font('Helvetica-Bold').fontSize(8)
             .text(cell, cx2 + 5, ry + 6, { width: tw, align: 'center', lineBreak: false })
          cx2 += colW[ci]; return
        }
      }
      doc.fillColor(C.text).font('Helvetica').fontSize(8)
         .text(cell, cx2 + 5, ry + 6, { width: colW[ci] - 10, align: align[ci] ?? 'left', lineBreak: false })
      cx2 += colW[ci]
    })
  })

  // Border
  const tableH = HH + rows.length * RH
  doc.rect(M, y, totalW, tableH).stroke(C.border)

  // Column dividers (subtle)
  let lx = M
  colW.slice(0, -1).forEach(w => {
    lx += w
    doc.moveTo(lx, y).lineTo(lx, y + tableH).stroke(C.border)
  })

  return y + tableH + 14
}

// ─── Main PDF generator ───────────────────────────────────────────────────────
export async function generateReportPDF(data: EmailKpisData): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default

  const { summary, timing, byLivreur, byHub, byDay,
          byCreneau, statusDistribution, onTimeDistribution,
          bestDay, worstDay, generatedAt } = data

  const hasP2 = !!(statusDistribution?.length || byCreneau?.length || bestDay || worstDay)
  const hasP3 = byLivreur.length > 0
  const hasP4 = byHub.length > 0 || byDay.length > 0
  const TOTAL = 1 + (hasP2 ? 1 : 0) + (hasP3 ? 1 : 0) + (hasP4 ? 1 : 0)

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true })
    const bufs: Buffer[] = []
    doc.on('data', (b: Buffer) => bufs.push(b))
    doc.on('end',  () => resolve(Buffer.concat(bufs)))
    doc.on('error', reject)

    let pg = 1

    // ── PAGE 1 ── Summary + KPI cards + Timeline ───────────────────────────
    drawHeader(doc, generatedAt)
    let y = HEADER_H + 16

    // Page title
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(19)
       .text('Rapport de Performance Livraison', M, y, { lineBreak: false })
    doc.fillColor(C.muted).font('Helvetica').fontSize(9.5)
       .text('Analyse complète des KPIs des tournées · généré automatiquement', M, y + 24, { lineBreak: false })
    y += 48

    // ── KPI cards — row 1 ──────────────────────────────────────────────────
    const CW4 = Math.floor((CW - 9) / 4); const CH = 62
    kpiCard(doc, M,              y, CW4, CH, 'Commandes total',  fmt(summary.totalOrders), C.blue,   C.blueLight)
    kpiCard(doc, M + CW4 + 3,   y, CW4, CH, 'Taux livraison',   fmtPct(summary.deliveryRate), rateColor(summary.deliveryRate), rateLight(summary.deliveryRate))
    kpiCard(doc, M + (CW4+3)*2, y, CW4, CH, 'On-Time',          fmtPct(summary.onTimeRate),   rateColor(summary.onTimeRate),   rateLight(summary.onTimeRate))
    kpiCard(doc, M + (CW4+3)*3, y, CW4, CH, 'Total COD',        fmtMAD(summary.totalCOD),     C.purple, C.purpleLight)
    y += CH + 8

    // ── KPI cards — row 2 ──────────────────────────────────────────────────
    kpiCard(doc, M,              y, CW4, CH, 'Livrées',          fmt(summary.delivered),    C.green,  C.greenLight)
    kpiCard(doc, M + CW4 + 3,   y, CW4, CH, 'NO_SHOW',          fmt(summary.noShow),       C.red,    C.redLight)
    kpiCard(doc, M + (CW4+3)*2, y, CW4, CH, 'Cmd / jour moy.',  summary.avgOrdersPerDay.toFixed(1), C.cyan, C.cyanLight)
    kpiCard(doc, M + (CW4+3)*3, y, CW4, CH, 'COD / commande',
      fmtMAD(summary.totalCOD / Math.max(summary.delivered, 1)), C.purple, C.purpleLight)
    y += CH + 18

    // ── Rate bars ──────────────────────────────────────────────────────────
    y = sectionTitle(doc, 'Taux de Performance', '📊', y)
    y = rateBar(doc, M, y, CW, 'Taux de livraison',     summary.deliveryRate, rateColor(summary.deliveryRate))
    y = rateBar(doc, M, y, CW, 'Taux on-time (créneaux)', summary.onTimeRate, rateColor(summary.onTimeRate))
    const noShowRate = summary.totalOrders > 0 ? (summary.noShow / summary.totalOrders) * 100 : 0
    y = rateBar(doc, M, y, CW, 'Taux NO_SHOW',           noShowRate, noShowRate > 20 ? C.red : C.orange)
    y += 10

    // ── Delivery pipeline ──────────────────────────────────────────────────
    if (timing) {
      y = sectionTitle(doc, 'Pipeline des délais moyens', '⏱️', y)
      const steps = [
        { label: 'Création\n→ Assigné',  val: fmtMin(timing.orderToAssign) },
        { label: 'Assigné\n→ Transport', val: fmtMin(timing.assignToTransport) },
        { label: 'Transport\n→ Départ',  val: fmtMin(timing.transportToStart) },
        { label: 'Départ\n→ Livré',      val: fmtMin(timing.startToDelivered) },
        { label: 'Durée\ntotale',        val: fmtMin(timing.totalDuration) },
      ]
      const R = 22; const SPACING = CW / 5
      const startX = M + SPACING / 2
      steps.forEach((s, i) => pipeStep(doc, startX + i * SPACING, y + R + 4, R, s.val, s.label, C.blue, i === 4))
      y += R * 2 + 30
    }

    drawFooter(doc, pg++, TOTAL)

    // ── PAGE 2 ── Status + Créneaux + Best/Worst ───────────────────────────
    if (hasP2) {
      doc.addPage()
      drawHeader(doc, generatedAt)
      y = HEADER_H + 16

      // Status distribution
      if (statusDistribution && statusDistribution.length > 0) {
        y = sectionTitle(doc, 'Distribution des statuts', '🔵', y)
        const total = statusDistribution.reduce((s, d) => s + d.value, 0)

        statusDistribution.forEach(item => {
          const pct = total > 0 ? (item.value / total) * 100 : 0
          const BH = 14; const bw = CW - 170
          doc.fillColor(C.text).font('Helvetica').fontSize(8.5)
             .text(item.name, M, y + 3, { width: 120, lineBreak: false })
          // Track
          doc.rect(M + 126, y, bw, BH).roundedRect(M + 126, y, bw, BH, 4).fill(C.border)
          const fw = Math.max(6, (pct / 100) * bw)
          doc.rect(M + 126, y, fw, BH).roundedRect(M + 126, y, fw, BH, 4).fill(item.color ?? C.blue)
          // Count + pct pill
          const pillX = M + 126 + bw + 6
          doc.rect(pillX, y, 42, BH).roundedRect(pillX, y, 42, BH, 4).fill(item.color ?? C.blue)
          doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7.5)
             .text(`${fmt(item.value)} (${pct.toFixed(1)}%)`, pillX, y + 3, { width: 42, align: 'center', lineBreak: false })
          y += BH + 10
        })
        y += 8
      }

      // On-time distribution
      if (onTimeDistribution && onTimeDistribution.length > 0) {
        doc.rect(M, y, CW, 1).fill(C.border); y += 12
        y = sectionTitle(doc, 'Respect des créneaux horaires', '⏰', y)
        const total = onTimeDistribution.reduce((s, d) => s + d.value, 0)
        onTimeDistribution.forEach(item => {
          const pct = total > 0 ? (item.value / total) * 100 : 0
          const BH = 14; const bw = CW - 170
          doc.fillColor(C.text).font('Helvetica').fontSize(8.5)
             .text(item.name, M, y + 3, { width: 120, lineBreak: false })
          doc.rect(M + 126, y, bw, BH).roundedRect(M + 126, y, bw, BH, 4).fill(C.border)
          const fw = Math.max(6, (pct / 100) * bw)
          doc.rect(M + 126, y, fw, BH).roundedRect(M + 126, y, fw, BH, 4).fill(item.color ?? C.green)
          const pillX = M + 126 + bw + 6
          doc.rect(pillX, y, 42, BH).roundedRect(pillX, y, 42, BH, 4).fill(item.color ?? C.green)
          doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7.5)
             .text(`${fmt(item.value)} (${pct.toFixed(1)}%)`, pillX, y + 3, { width: 42, align: 'center', lineBreak: false })
          y += BH + 10
        })
        y += 8
      }

      // Best / Worst day cards
      if (bestDay || worstDay) {
        doc.rect(M, y, CW, 1).fill(C.border); y += 12
        y = sectionTitle(doc, 'Meilleure & Pire journée', '📅', y)
        const CARD_W = (CW - 12) / 2; const CARD_H = 70

        if (bestDay) {
          // Shadow
          doc.rect(M + 2, y + 2, CARD_W, CARD_H).roundedRect(M + 2, y + 2, CARD_W, CARD_H, 6).fill('#d1fae5')
          doc.rect(M, y, CARD_W, CARD_H).roundedRect(M, y, CARD_W, CARD_H, 6).fill(C.greenLight)
          doc.rect(M, y, CARD_W, 3).roundedRect(M, y, CARD_W, 3, 6).fill(C.green)
          doc.fillColor(C.green).font('Helvetica-Bold').fontSize(8)
             .text('🏆  MEILLEURE JOURNÉE', M + 10, y + 10, { lineBreak: false })
          doc.fillColor(C.text).font('Helvetica-Bold').fontSize(18)
             .text(bestDay.date, M + 10, y + 22, { lineBreak: false })
          doc.fillColor(C.muted).font('Helvetica').fontSize(8)
             .text(`${fmt(bestDay.volume)} colis  ·  durée moy. ${fmtMin(bestDay.avgDuration)}`, M + 10, y + 46, { lineBreak: false })
        }
        if (worstDay) {
          const wx = M + CARD_W + 12
          doc.rect(wx + 2, y + 2, CARD_W, CARD_H).roundedRect(wx + 2, y + 2, CARD_W, CARD_H, 6).fill('#fed7aa')
          doc.rect(wx, y, CARD_W, CARD_H).roundedRect(wx, y, CARD_W, CARD_H, 6).fill(C.orangeLight)
          doc.rect(wx, y, CARD_W, 3).roundedRect(wx, y, CARD_W, 3, 6).fill(C.orange)
          doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(8)
             .text('⚠️  JOURNÉE LA PLUS LENTE', wx + 10, y + 10, { lineBreak: false })
          doc.fillColor(C.text).font('Helvetica-Bold').fontSize(18)
             .text(worstDay.date, wx + 10, y + 22, { lineBreak: false })
          doc.fillColor(C.muted).font('Helvetica').fontSize(8)
             .text(`${fmt(worstDay.volume)} colis  ·  durée moy. ${fmtMin(worstDay.avgDuration)}`, wx + 10, y + 46, { lineBreak: false })
        }
        y += CARD_H + 16
      }

      // Créneaux table
      if (byCreneau && byCreneau.length > 0) {
        doc.rect(M, y, CW, 1).fill(C.border); y += 12
        y = sectionTitle(doc, 'Performance par créneau horaire', '🕐', y)
        y = drawTable(
          doc,
          ['Créneau', 'Total', 'Livrées', 'NO_SHOW', 'Taux livraison', 'On-Time', 'Durée moy.'],
          byCreneau.map(c => ({
            cells: [c.creneau, fmt(c.total), fmt(c.delivered), fmt(c.noShow), fmtPct(c.deliveryRate), fmtPct(c.onTimeRate), fmtMin(c.avgDuration)],
            rateIdx: 4,
          })),
          [115, 52, 54, 58, 72, 64, 72],
          ['left','right','right','right','right','right','right'],
          y
        )
      }

      drawFooter(doc, pg++, TOTAL)
    }

    // ── PAGE 3 ── Classement livreurs ──────────────────────────────────────
    if (hasP3) {
      doc.addPage()
      drawHeader(doc, generatedAt)
      y = HEADER_H + 16

      y = sectionTitle(doc, 'Classement des Livreurs', '🏆', y)

      // Top 3 podium cards
      const top3 = byLivreur.slice(0, 3)
      if (top3.length > 0) {
        const PC_W = Math.floor((CW - 8) / 3); const PC_H = 68
        const podiumColors = [
          { accent: '#f59e0b', bg: '#fffbeb', emoji: '🥇' },
          { accent: '#94a3b8', bg: '#f8fafc', emoji: '🥈' },
          { accent: '#d97706', bg: '#fffbeb', emoji: '🥉' },
        ]
        top3.forEach((l, i) => {
          const px = M + i * (PC_W + 4)
          const pc = podiumColors[i]
          doc.rect(px + 2, y + 2, PC_W, PC_H).roundedRect(px + 2, y + 2, PC_W, PC_H, 5).fill('#e2e8f0')
          doc.rect(px, y, PC_W, PC_H).roundedRect(px, y, PC_W, PC_H, 5).fill(pc.bg)
          doc.rect(px, y, PC_W, 3).roundedRect(px, y, PC_W, 3, 5).fill(pc.accent)
          doc.fillColor(pc.accent).font('Helvetica-Bold').fontSize(16)
             .text(pc.emoji, px + 6, y + 8, { lineBreak: false })
          doc.fillColor(C.text).font('Helvetica-Bold').fontSize(8.5)
             .text(l.name, px + 6, y + 28, { width: PC_W - 12, lineBreak: false })
          doc.fillColor(pc.accent).font('Helvetica-Bold').fontSize(13)
             .text(fmtPct(l.deliveryRate), px + 6, y + 41, { lineBreak: false })
          doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
             .text(`${l.total} cmd · ${fmtMAD(l.totalCOD)}`, px + 6, y + 56, { width: PC_W - 12, lineBreak: false })
        })
        y += PC_H + 12
      }

      y = drawTable(
        doc,
        ['Rang', 'Livreur', 'Total', 'Livrées', 'NO_SHOW', 'Taux liv.', 'On-Time', 'Durée', 'COD'],
        byLivreur.slice(0, 28).map((l, i) => ({
          cells: [`#${l.rank}`, l.name, fmt(l.total), fmt(l.delivered), fmt(l.noShow),
                  fmtPct(l.deliveryRate), fmtPct(l.onTimeRate), fmtMin(l.avgDuration), fmtMAD(l.totalCOD)],
          highlight: i < 3,
          rateIdx: 5,
        })),
        [36, 110, 40, 42, 44, 54, 52, 46, 88],
        ['left','left','right','right','right','right','right','right','right'],
        y
      )

      drawFooter(doc, pg++, TOTAL)
    }

    // ── PAGE 4 ── Hubs + Daily trend ───────────────────────────────────────
    if (hasP4) {
      doc.addPage()
      drawHeader(doc, generatedAt)
      y = HEADER_H + 16

      if (byHub.length > 0) {
        y = sectionTitle(doc, 'Performance par Hub', '📍', y)

        // Hub bar chart (visual)
        const maxCOD = Math.max(...byHub.map(h => h.totalCOD), 1)
        const barW = 120

        byHub.slice(0, 8).forEach((h, i) => {
          const hy = y + i * 28
          if (hy > PAGE_H - 100) return // page overflow guard

          const rank = i === 0 ? '🏆' : `#${i + 1}`
          doc.fillColor(C.text).font('Helvetica').fontSize(8)
             .text(`${rank} ${h.hubName}`, M, hy + 4, { width: 130, lineBreak: false })
          // Rate bar
          const bx = M + 136; const bh = 10
          const rc = rateColor(h.deliveryRate)
          doc.rect(bx, hy, barW, bh).roundedRect(bx, hy, barW, bh, 4).fill(C.border)
          const fw2 = Math.max(6, (h.deliveryRate / 100) * barW)
          doc.rect(bx, hy, fw2, bh).roundedRect(bx, hy, fw2, bh, 4).fill(rc)
          // Rate pill
          doc.rect(bx + barW + 4, hy - 1, 40, 12).roundedRect(bx + barW + 4, hy - 1, 40, 12, 3).fill(rc)
          doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7.5)
             .text(fmtPct(h.deliveryRate), bx + barW + 4, hy + 1, { width: 40, align: 'center', lineBreak: false })
          // COD bar (purple)
          const cx2 = bx + barW + 50; const cbarW = CW - 136 - barW - 54
          doc.rect(cx2, hy, cbarW, bh).roundedRect(cx2, hy, cbarW, bh, 4).fill(C.border)
          const cfw = Math.max(4, (h.totalCOD / maxCOD) * cbarW)
          doc.rect(cx2, hy, cfw, bh).roundedRect(cx2, hy, cfw, bh, 4).fill(C.purple)
          doc.fillColor(C.muted).font('Helvetica').fontSize(7)
             .text(fmtMAD(h.totalCOD), cx2 + cbarW + 4, hy + 2, { lineBreak: false })
        })
        y += Math.min(byHub.length, 8) * 28 + 14

        // Full hub table
        y = drawTable(
          doc,
          ['Hub', 'Ville', 'Total', 'Livrées', 'Taux', 'Durée', 'COD Total'],
          byHub.slice(0, 12).map((h, i) => ({
            cells: [h.hubName, h.hubCity || '—', fmt(h.total), fmt(h.delivered),
                    fmtPct(h.deliveryRate), fmtMin(h.avgDuration), fmtMAD(h.totalCOD)],
            highlight: i === 0,
            rateIdx: 4,
          })),
          [105, 75, 44, 48, 56, 52, 90],
          ['left','left','right','right','right','right','right'],
          y
        )
      }

      // Daily trend
      if (byDay.length > 0 && y < PAGE_H - 120) {
        doc.rect(M, y, CW, 1).fill(C.border); y += 12
        y = sectionTitle(doc, 'Tendance journalière (20 derniers jours)', '📈', y)
        y = drawTable(
          doc,
          ['Date', 'Total', 'Livrées', 'NO_SHOW', 'Taux livraison', 'COD Total'],
          byDay.slice(-20).map(d => ({
            cells: [d.date, fmt(d.total), fmt(d.delivered), fmt(d.noShow),
                    fmtPct(d.deliveryRate), fmtMAD(d.totalCOD)],
            rateIdx: 4,
          })),
          [90, 54, 56, 58, 96, 110],
          ['left','right','right','right','right','right'],
          y
        )
      }

      drawFooter(doc, pg, TOTAL)
    }

    doc.end()
  })
}
