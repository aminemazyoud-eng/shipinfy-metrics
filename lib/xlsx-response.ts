import * as XLSX from 'xlsx'

// Exports Excel : toutes les routes d'export construisent leur tableau en CSV (« ; » ou « , », BOM, guillemets) ;
// ce module le convertit en vrai fichier .xlsx (nombres typés, colonnes dimensionnées, ligne d'en-tête figée).

function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const first = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) && first.includes(';') ? ';' : ','
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === sep) { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows.filter(r => r.some(c => c !== ''))
}

const TEXT_HEADER = /^(r[ée]f|code|cin|t[ée]l|plaque|immat|p[ée]riode|objet)/i
// Neutralisation des formules (Sprint 17 A7) : une cellule TEXTE commençant par = + - @ tab ou CR est préfixée d'une apostrophe.
// Exception : valeurs purement numériques/téléphone (chiffres, espaces, parenthèses, points, tirets, signe initial) — aucune formule possible.
const DANGER = /^[=+\-@\t\r]/
const PLAIN_NUMBERISH = /^[+-]?[\d\s().-]+$/
const safeCell = (v: string): string => (DANGER.test(v) && !PLAIN_NUMBERISH.test(v) ? "'" + v : v)
const NUM = /^-?(0|[1-9]\d{0,14})([.,]\d+)?$/

export function csvToXlsx(csv: string, sheet = 'Export'): Buffer {
  const rows = parseCsv(csv)
  const head = rows[0] ?? []
  const data: (string | number)[][] = rows.map((r, ri) => r.map((c, ci) => (ri > 0 && !TEXT_HEADER.test(head[ci] ?? '') && NUM.test(c) ? Number(c.replace(',', '.')) : safeCell(c))))
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = head.map((_, ci) => ({ wch: Math.min(40, Math.max(8, ...data.slice(0, 200).map(r => String(r[ci] ?? '').length + 2))) }))
  ws['!freeze'] = { xSplit: 0, ySplit: 1 } as never
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31))
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** Réponse HTTP téléchargeable (.xlsx) à partir d'un texte CSV. */
export function xlsxResponse(csv: string, filename: string, sheet = 'Export'): Response {
  return new Response(new Uint8Array(csvToXlsx(csv, sheet)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename.replace(/\.csv$/i, '')}.xlsx"`,
    },
  })
}
