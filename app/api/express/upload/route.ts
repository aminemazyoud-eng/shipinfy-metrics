import { NextResponse } from 'next/server'
import { Worker } from 'worker_threads'
import { prisma } from '@/lib/prisma'
import { toMoroccoTime } from '@/lib/timezone'
import { trackUpload } from '@/lib/upload-progress'

export const runtime = 'nodejs'
export const maxDuration = 60

// ── EXPRESS column mapping ────────────────────────────────────────────────────
const EXPRESS_COLUMN_MAP: Record<string, string> = {
  order_id:       'orderId',
  driver_name:    'driverName',
  picker_id:      'pickerId',
  hub:            'hubName',
  zone:           'zone',
  status:         'status',
  picking_start:  'pickingStartAt',
  picking_end:    'pickingEndAt',
  delivery_start: 'deliveryStartAt',
  delivery_end:   'deliveryEndAt',
  sla_minutes:    'slaTarget',
  sla_ok:         'slaRespected',
  address:        'customerAddress',
  store_type:     'storeType',
}

const DATE_FIELDS = new Set([
  'pickingStartAt', 'pickingEndAt', 'deliveryStartAt', 'deliveryEndAt',
])

// ── Worker Thread script — mirror of /api/dashboard/upload (F1 + F9) ──────────
const XLSX_WORKER_SCRIPT = `
const { workerData, parentPort } = require('worker_threads')
const path = require('path')
try {
  const XLSX = require(path.join(process.cwd(), 'node_modules', 'xlsx'))
  const buf = Buffer.isBuffer(workerData) ? workerData : Buffer.from(workerData)
  const wb = XLSX.read(buf, {
    type: 'buffer',
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    sheetStubs: false,
    sheetRows: 200000,
  })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })
  const filtered = rows.filter(row =>
    Object.values(row).some(v => v !== null && v !== '' && v !== undefined)
  )
  parentPort.postMessage({ rows: filtered })
} catch (e) {
  parentPort.postMessage({ error: String(e) })
}
`

function parseXlsxAsync(buffer: Buffer): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const clean = Buffer.allocUnsafe(buffer.length)
    buffer.copy(clean)

    const worker = new Worker(XLSX_WORKER_SCRIPT, { eval: true, workerData: clean })

    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('XLSX parsing timeout (120s)'))
    }, 120_000)

    worker.once('message', (msg: { rows?: Record<string, unknown>[]; error?: string }) => {
      clearTimeout(timer)
      worker.terminate()
      if (msg.error) reject(new Error(msg.error))
      else resolve(msg.rows ?? [])
    })
    worker.once('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

function parseSlaRespected(raw: unknown): boolean | null {
  if (raw === null || raw === undefined || raw === '') return null
  const s = String(raw).trim().toLowerCase()
  if (s === 'true' || s === '1' || s === 'yes' || s === 'oui' || s === 'ok') return true
  if (s === 'false' || s === '0' || s === 'no' || s === 'non') return false
  return null
}

function mapRow(row: Record<string, unknown>, reportId: string): Record<string, unknown> {
  const order: Record<string, unknown> = { reportId }
  for (const [excelCol, dbField] of Object.entries(EXPRESS_COLUMN_MAP)) {
    const raw = row[excelCol]
    if (DATE_FIELDS.has(dbField)) {
      order[dbField] = toMoroccoTime(raw)
    } else if (dbField === 'slaTarget') {
      const n = parseInt(String(raw ?? ''), 10)
      order[dbField] = isNaN(n) ? 45 : n
    } else if (dbField === 'slaRespected') {
      order[dbField] = parseSlaRespected(raw)
    } else if (dbField === 'orderId' || dbField === 'driverName' || dbField === 'status') {
      order[dbField] = raw != null ? String(raw) : ''
    } else {
      order[dbField] = raw != null ? String(raw) : null
    }
  }
  return order
}

// ── Background DB insertion ───────────────────────────────────────────────────
async function insertBackground(reportId: string, orders: Record<string, unknown>[]) {
  const state = trackUpload(reportId, orders.length)
  const BATCH = 500
  try {
    for (let i = 0; i < orders.length; i += BATCH) {
      await prisma.expressOrder.createMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: orders.slice(i, i + BATCH) as any,
        skipDuplicates: true,
      })
      state.inserted = Math.min(i + BATCH, orders.length)
    }
    state.inserted = orders.length
    state.done = true
  } catch (e) {
    state.error = String(e)
    state.done = true
    console.error('[express/upload/background]', e)
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const name = file.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      return NextResponse.json({ error: 'Format non supporté (.xlsx/.xls uniquement)' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let rows: Record<string, unknown>[]
    try {
      rows = await parseXlsxAsync(buffer)
    } catch (e) {
      console.error('[express/upload/parse]', e)
      return NextResponse.json(
        { error: 'Impossible de lire le fichier Excel. Vérifiez le format.' },
        { status: 422 }
      )
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Le fichier ne contient aucune ligne de données.' }, { status: 400 })
    }

    // ── most common store_type in the file ───────────────────────────────────
    const storeCounts = new Map<string, number>()
    for (const r of rows) {
      const st = r['store_type']
      if (st != null && String(st).trim() !== '') {
        const key = String(st).trim()
        storeCounts.set(key, (storeCounts.get(key) ?? 0) + 1)
      }
    }
    let storeType: string | null = null
    let best = 0
    for (const [k, c] of storeCounts.entries()) {
      if (c > best) { best = c; storeType = k }
    }

    const report = await prisma.expressReport.create({
      data: { filename: file.name, totalRows: rows.length, storeType },
    })
    const orders = rows.map(row => mapRow(row, report.id))

    // ── Fire & forget ───────────────────────────────────────────────────────
    insertBackground(report.id, orders).catch(console.error)

    return NextResponse.json({
      reportId:   report.id,
      filename:   file.name,
      totalRows:  rows.length,
      insertedAt: report.uploadedAt,
    })
  } catch (e) {
    console.error('[express/upload]', e)
    return NextResponse.json({ error: 'Import échoué. Vérifiez le format du fichier.' }, { status: 500 })
  }
}
