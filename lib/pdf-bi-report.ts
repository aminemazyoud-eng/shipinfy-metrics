/**
 * lib/pdf-bi-report.ts — PDF des rapports planifiés Control Tower (A4 paysage) : cartes KPI + tableaux par section.
 * pdfkit + Helvetica : pas d'emoji ni de symboles hors WinAnsi (≥, →, espaces fines…) → nettoyés par clean().
 */
import type { BiReport } from '@/lib/bi-report'
import type { Tbl } from '@/lib/ops-bi'

const W = 842, H = 595, M = 30, CW = W - M * 2
const C = { navy: '#0f172a', blue: '#2563eb', purple: '#7c3aed', gray: '#64748b', light: '#f1f5f9', border: '#e2e8f0', text: '#0f172a', white: '#ffffff' }
const ROW_H = 13, FOOT = 28

/** Remplace les caractères que Helvetica (WinAnsi) ne sait pas dessiner. */
export const clean = (s: string): string => String(s ?? '')
  .replace(/[  ]/g, ' ').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(/↳/g, '>').replace(/[▸▾]/g, '').replace(/−/g, '-').replace(/’/g, "'")

export async function generateBiReportPDF(report: BiReport, meta: { title: string; periodText: string }): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [W, H], margin: 0, bufferPages: true })
    const bufs: Buffer[] = []
    doc.on('data', (b: Buffer) => bufs.push(b))
    doc.on('end', () => resolve(Buffer.concat(bufs)))
    doc.on('error', reject)

    const header = () => {
      doc.rect(0, 0, W, 52).fill(C.navy)
      doc.rect(0, 48, W, 4).fill(C.blue)
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(15).text(clean(meta.title), M, 14, { lineBreak: false })
      doc.fillColor('#cbd5e1').font('Helvetica').fontSize(8.5)
        .text(clean(`${meta.periodText}  |  Magasin : ${report.hub ?? 'tous'}  |  ${report.totalOrders} commandes`), M, 33, { lineBreak: false })
    }
    let y = 0
    const newPage = () => { doc.addPage({ size: [W, H], margin: 0 }); header(); y = 66 }
    header(); y = 66

    const ensure = (h: number) => { if (y + h > H - FOOT) newPage() }

    const cards = (list: { label: string; value: string; note: string }[]) => {
      const per = Math.min(6, Math.max(1, list.length)), gap = 6, cw = (CW - gap * (per - 1)) / per, ch = 46
      for (let i = 0; i < list.length; i += per) {
        ensure(ch + 8)
        list.slice(i, i + per).forEach((c, j) => {
          const x = M + j * (cw + gap)
          doc.roundedRect(x, y, cw, ch, 4).lineWidth(0.6).fillAndStroke(C.light, C.border)
          doc.fillColor(C.gray).font('Helvetica-Bold').fontSize(6.3).text(clean(c.label).toUpperCase(), x + 6, y + 6, { width: cw - 12, height: 8, ellipsis: true, lineBreak: false })
          doc.fillColor(C.text).font('Helvetica-Bold').fontSize(13).text(clean(c.value), x + 6, y + 17, { width: cw - 12, height: 16, ellipsis: true, lineBreak: false })
          doc.fillColor(C.gray).font('Helvetica').fontSize(6.3).text(clean(c.note), x + 6, y + 35, { width: cw - 12, height: 8, ellipsis: true, lineBreak: false })
        })
        y += ch + 6
      }
      y += 4
    }

    const table = (title: string, t: Tbl) => {
      if (!t.rows.length) return
      const cols = t.head.length
      const first = cols > 6 ? CW * 0.2 : CW * 0.28
      const other = (CW - first) / Math.max(1, cols - 1)
      const widths = t.head.map((_, i) => (i === 0 ? first : other))
      const drawHead = () => {
        doc.rect(M, y, CW, ROW_H + 2).fill(C.light)
        let x = M
        t.head.forEach((h, i) => {
          doc.fillColor(C.gray).font('Helvetica-Bold').fontSize(6.6).text(clean(h), x + 3, y + 4, { width: widths[i] - 6, height: ROW_H, ellipsis: true, lineBreak: false, align: i === 0 ? 'left' : 'right' })
          x += widths[i]
        })
        y += ROW_H + 2
      }
      ensure(24 + ROW_H * 3)
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(9).text(clean(title), M, y, { lineBreak: false })
      y += 14
      drawHead()
      t.rows.forEach((r, ri) => {
        if (y + ROW_H > H - FOOT) { newPage(); doc.fillColor(C.gray).font('Helvetica').fontSize(7).text(clean(`${title} (suite)`), M, y - 4, { lineBreak: false }); y += 10; drawHead() }
        const total = r[0] === 'TOTAL'
        if (total) doc.rect(M, y, CW, ROW_H).fill(C.light)
        else if (ri % 2) doc.rect(M, y, CW, ROW_H).fill('#fafbfd')
        let x = M
        r.forEach((cell, i) => {
          doc.fillColor(C.text).font(total ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.8).text(clean(cell), x + 3, y + 3.5, { width: widths[i] - 6, height: ROW_H, ellipsis: true, lineBreak: false, align: i === 0 ? 'left' : 'right' })
          x += widths[i]
        })
        y += ROW_H
      })
      y += 10
    }

    report.sections.forEach((s, si) => {
      if (si > 0) newPage()
      ensure(70)
      doc.roundedRect(M, y, CW, 20, 3).fill(C.purple)
      doc.fillColor(C.white).font('Helvetica-Bold').fontSize(11).text(clean(s.title), M + 10, y + 5.5, { lineBreak: false })
      y += 28
      cards(s.cards)
      s.tables.forEach(t => table(t.title, t.tbl))
    })

    // Pied de page : numéros de pages
    const range = doc.bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i)
      doc.fillColor(C.gray).font('Helvetica').fontSize(7).text(clean(`Shipinfy Metrics  |  Rapport genere le ${new Date(report.generatedAt).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' })}`), M, H - 18, { lineBreak: false })
      doc.text(`Page ${i + 1} / ${range.count}`, W - M - 80, H - 18, { width: 80, align: 'right', lineBreak: false })
    }
    doc.end()
  })
}
