import { NextResponse } from 'next/server'
import { Worker } from 'worker_threads'
import { prisma } from '@/lib/prisma'
import { COLUMN_MAP } from '@/lib/excel-mapping'
import { toMoroccoTime } from '@/lib/timezone'
import { trackUpload } from '@/lib/upload-progress'

export const maxDuration = 60

// ── Worker Thread script — XLSX.read() runs in a separate thread ─────────────
// This prevents blocking the Node.js event loop during large file parsing.
// Using eval:true avoids file path issues in Docker standalone builds.
const XLSX_WORKER_SCRIPT = `
const { workerData, parentPort } = require('worker_threads')
const XLSX = require('xlsx')
try {
  const buf = Buffer.from(workerData)
  const wb = XLSX.read(buf, {
    type: 'buffer',
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    sheetStubs: false,
  })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })
  parentPort.postMessage({ rows })
} catch (e) {
  parentPort.postMessage({ error: String(e) })
}
`

function parseXlsxAsync(buffer: Buffer): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    // Transfer the ArrayBuffer to the worker (zero-copy, avoids 5MB clone)
    const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const abuf  = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength) as ArrayBuffer

    const worker = new Worker(XLSX_WORKER_SCRIPT, {
      eval: true,
      workerData: abuf,
      transferList: [abuf],
    })

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

// ── Column mapping ────────────────────────────────────────────────────────────
const DATE_FIELDS = new Set([
  'pickupTimeStart', 'deliveryTimeStart', 'deliveryTimeEnd',
  'dateTimeWhenOrderSent', 'dateTimeWhenAssigned', 'dateTimeWhenInTransport',
  'dateTimeWhenStartDelivery', 'dateTimeWhenDelivered', 'dateTimeWhenNoShow',
  'dateTimeLastUpdate',
])

const FLOAT_FIELDS = new Set([
  'paymentOnDeliveryAmount', 'destinationLongitude', 'destinationLatitude',
  'originHubLongitude', 'originHubLatitude', 'sprintGeoLongitude', 'sprintGeoLatitude',
])

function mapRow(row: Record<string, unknown>, reportId: string): Record<string, unknown> {
  const order: Record<string, unknown> = { reportId }
  for (const [excelCol, dbField] of Object.entries(COLUMN_MAP)) {
    const raw = row[excelCol]
    if (DATE_FIELDS.has(dbField)) {
      order[dbField] = toMoroccoTime(raw)
    } else if (FLOAT_FIELDS.has(dbField)) {
      const n = parseFloat(String(raw ?? ''))
      order[dbField] = isNaN(n) ? null : n
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
      await prisma.deliveryOrder.createMany({
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
    state.done  = true
    console.error('[upload/background]', e)
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

    // ── Parse XLSX in Worker Thread (non-blocking) ────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer())
    let rows: Record<string, unknown>[]
    try {
      rows = await parseXlsxAsync(buffer)
    } catch (e) {
      console.error('[upload/parse]', e)
      return NextResponse.json(
        { error: 'Impossible de lire le fichier Excel. Vérifiez le format.' },
        { status: 422 }
      )
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Le fichier ne contient aucune ligne de données.' }, { status: 400 })
    }

    // ── Create report record ─────────────────────────────────────────────────
    const report = await prisma.deliveryReport.create({ data: { filename: file.name } })
    const orders = rows.map(row => mapRow(row, report.id))

    // ── Fire & forget — respond immediately, insert in background ────────────
    insertBackground(report.id, orders).catch(console.error)

    return NextResponse.json({
      reportId:   report.id,
      filename:   file.name,
      totalRows:  rows.length,
      insertedAt: report.uploadedAt,
    })

  } catch (e) {
    console.error('[upload]', e)
    return NextResponse.json({ error: 'Import échoué. Vérifiez le format du fichier.' }, { status: 500 })
  }
}
