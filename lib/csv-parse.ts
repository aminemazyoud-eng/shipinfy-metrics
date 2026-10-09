// Parseur CSV minimal (séparateur « ; » ou « , » détecté sur la 1re ligne, BOM, guillemets doublés).
// Partagé par les exports (lib/xlsx-response.ts) et les imports (lib/xlsx-import.ts).
export function parseCsv(text: string): string[][] {
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
