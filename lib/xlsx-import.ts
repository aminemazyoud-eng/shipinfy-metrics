import { Worker } from 'worker_threads'
import { parseCsv } from '@/lib/csv-parse'

// Import de tableurs (routes d'upload). Remplace la lib `xlsx` (SheetJS) vulnérable par `exceljs`.
//  - formats acceptés : .xlsx (ZIP « PK ») et .csv ; le .xls binaire (BIFF) est REFUSÉ (aucun parseur sûr).
//  - taille max 10 Mo, 200 000 lignes max, parsing dans un worker thread (timeout 120 s, mémoire plafonnée).
//  - cellules à formule : on lit la valeur calculée (`result`), jamais d'évaluation.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_ROWS = 200_000

export type UploadKind = 'xlsx' | 'csv'
export type UploadCheck = { ok: true; kind: UploadKind } | { ok: false; error: string; status: number }

export const isZip = (buf: Uint8Array): boolean =>
  buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) && (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)

/** Valide nom + taille + signature avant tout parsing. */
export function validateUploadFile(filename: string, buf: Uint8Array): UploadCheck {
  const name = (filename || '').toLowerCase()
  if (buf.length === 0) return { ok: false, error: 'Fichier vide.', status: 400 }
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, error: 'Fichier trop volumineux (10 Mo maximum).', status: 413 }
  if (name.endsWith('.xls')) {
    return { ok: false, error: "Le format .xls (ancien Excel binaire) n'est plus accepté pour des raisons de sécurité. Ouvrez le fichier dans Excel puis enregistrez-le au format .xlsx (ou .csv).", status: 400 }
  }
  if (name.endsWith('.xlsx')) {
    if (!isZip(buf)) return { ok: false, error: 'Fichier .xlsx invalide (signature ZIP absente).', status: 400 }
    return { ok: true, kind: 'xlsx' }
  }
  if (name.endsWith('.csv')) {
    if (isZip(buf) || buf.subarray(0, 4096).includes(0)) return { ok: false, error: 'Fichier .csv invalide (contenu binaire).', status: 400 }
    return { ok: true, kind: 'csv' }
  }
  return { ok: false, error: 'Format non supporté (.xlsx ou .csv uniquement)', status: 400 }
}

// Worker : exceljs doit être résolu depuis node_modules (serverExternalPackages dans next.config.ts).
const WORKER_SCRIPT = `
const { workerData, parentPort } = require('worker_threads')
const path = require('path')
const MAX_ROWS = ${MAX_ROWS}
function plain(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'object') {
    if ('result' in v) return plain(v.result)
    if ('formula' in v || 'sharedFormula' in v) return null
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('')
    if ('error' in v) return null
    if ('text' in v) return plain(v.text)
    return null
  }
  return v
}
;(async () => {
  try {
    const ExcelJS = require(path.join(process.cwd(), 'node_modules', 'exceljs'))
    const buf = Buffer.isBuffer(workerData) ? workerData : Buffer.from(workerData)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.worksheets[0]
    if (!ws) { parentPort.postMessage({ rows: [] }); return }
    const heads = []
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      const h = plain(cell.value)
      if (h !== null && String(h).trim() !== '') heads.push([col, String(h)])
    })
    const rows = []
    const last = Math.min(ws.rowCount, MAX_ROWS + 1)
    for (let r = 2; r <= last; r++) {
      const row = ws.getRow(r)
      const o = {}
      let any = false
      for (const [col, name] of heads) {
        if (name in o) continue
        const v = plain(row.getCell(col).value)
        o[name] = v
        if (v !== null && v !== '') any = true
      }
      if (any) rows.push(o)
    }
    parentPort.postMessage({ rows })
  } catch (e) {
    parentPort.postMessage({ error: String(e) })
  }
})()
`

function parseXlsxAsync(buffer: Buffer): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const clean = Buffer.allocUnsafe(buffer.length); buffer.copy(clean)
    const worker = new Worker(WORKER_SCRIPT, { eval: true, workerData: clean, resourceLimits: { maxOldGenerationSizeMb: 768 } })
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('XLSX parsing timeout (120s)')) }, 120_000)
    worker.once('message', (msg: { rows?: Record<string, unknown>[]; error?: string }) => {
      clearTimeout(timer); worker.terminate()
      if (msg.error) reject(new Error(msg.error)); else resolve(msg.rows ?? [])
    })
    worker.once('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

function parseCsvRows(buffer: Buffer): Record<string, unknown>[] {
  const table = parseCsv(buffer.toString('utf8'))
  const head = (table[0] ?? []).map(h => h.trim())
  const out: Record<string, unknown>[] = []
  for (const r of table.slice(1, MAX_ROWS + 1)) {
    const o: Record<string, unknown> = {}
    head.forEach((h, i) => { if (h && !(h in o)) o[h] = r[i] === undefined || r[i] === '' ? null : r[i] })
    if (Object.values(o).some(v => v !== null)) out.push(o)
  }
  return out
}

/** Lit la 1re feuille (ligne 1 = en-têtes) et renvoie des objets { en-tête: valeur }. Lève une erreur si illisible. */
export async function parseSpreadsheetRows(buffer: Buffer, kind: UploadKind): Promise<Record<string, unknown>[]> {
  return kind === 'csv' ? parseCsvRows(buffer) : parseXlsxAsync(buffer)
}
