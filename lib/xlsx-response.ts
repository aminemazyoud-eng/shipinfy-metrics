import ExcelJS from 'exceljs'
import { parseCsv } from '@/lib/csv-parse'

// Exports Excel : toutes les routes d'export construisent leur tableau en CSV (« ; » ou « , », BOM, guillemets) ;
// ce module le convertit en vrai fichier .xlsx (nombres typés, colonnes dimensionnées, ligne d'en-tête figée).
// Sécurité : la lib `xlsx` (SheetJS, vulnérable, sans correctif npm) a été remplacée par `exceljs`.

const TEXT_HEADER = /^(r[ée]f|code|cin|t[ée]l|plaque|immat|p[ée]riode|objet)/i
// Neutralisation des formules (Sprint 17 A7) : une cellule TEXTE commençant par = + - @ tab ou CR est préfixée d'une apostrophe.
// Exception : valeurs purement numériques/téléphone (chiffres, espaces, parenthèses, points, tirets, signe initial) — aucune formule possible.
const DANGER = /^[=+\-@\t\r]/
const PLAIN_NUMBERISH = /^[+-]?[\d\s().-]+$/
const safeCell = (v: string): string => (DANGER.test(v) && !PLAIN_NUMBERISH.test(v) ? "'" + v : v)
const NUM = /^-?(0|[1-9]\d{0,14})([.,]\d+)?$/

/** CSV -> contenu binaire .xlsx. (Asynchrone : exceljs n'a pas d'écriture synchrone.) */
export async function csvToXlsx(csv: string, sheet = 'Export'): Promise<Buffer> {
  const rows = parseCsv(csv)
  const head = rows[0] ?? []
  const data: (string | number)[][] = rows.map((r, ri) => r.map((c, ci) => (ri > 0 && !TEXT_HEADER.test(head[ci] ?? '') && NUM.test(c) ? Number(c.replace(',', '.')) : safeCell(c))))
  const wb = new ExcelJS.Workbook()
  // Nom d'onglet : 31 caractères max, sans \ / ? * [ ] :
  const ws = wb.addWorksheet(sheet.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Export', { views: head.length ? [{ state: 'frozen', xSplit: 0, ySplit: 1 }] : [] })
  data.forEach(r => ws.addRow(r))
  head.forEach((h, ci) => {
    const col = ws.getColumn(ci + 1)
    col.width = Math.min(40, Math.max(8, ...data.slice(0, 200).map(r => String(r[ci] ?? '').length + 2)))
    if (TEXT_HEADER.test(h)) col.numFmt = '@'
  })
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** Réponse HTTP téléchargeable (.xlsx) à partir d'un texte CSV (signature synchrone conservée : le corps est produit en flux). */
export function xlsxResponse(csv: string, filename: string, sheet = 'Export'): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try { controller.enqueue(new Uint8Array(await csvToXlsx(csv, sheet))); controller.close() }
      catch (e) { controller.error(e) }
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename.replace(/\.csv$/i, '')}.xlsx"`,
    },
  })
}
