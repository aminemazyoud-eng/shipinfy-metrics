import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { COLUMN_MAP } from '@/lib/excel-mapping'
import { toMoroccoTime } from '@/lib/timezone'
import { trackUpload } from '@/lib/upload-progress'

// Server parses XLSX in <3s then returns immediately.
// Row insertion runs in background — no Traefik timeout risk.
export const maxDuration = 60

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

// Background insertion — runs after HTTP response is sent.
// Safe in Next.js standalone (persistent Node.js process, not serverless).
async function insertBackground(
  reportId: string,
  orders: Record<string, unknown>[],
) {
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
    state.done     = true
  } catch (e) {
    state.error = String(e)
    state.done  = true
    console.error('[upload/background]', e)
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const name = file.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      return NextResponse.json({ error: 'Format non supporté (.xlsx/.xls uniquement)' }, { status: 400 })
    }

    // ── Parse XLSX in memory (fast: ~1-2s for 9000 rows) ──────────────────────
    const XLSX     = await import('xlsx')
    const buffer   = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
    const sheet    = workbook.Sheets[workbook.SheetNames[0]]
    const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Le fichier ne contient aucune ligne de données.' }, { status: 400 })
    }

    // ── Create report record ──────────────────────────────────────────────────
    const report = await prisma.deliveryReport.create({ data: { filename: file.name } })
    const orders = rows.map(row => mapRow(row, report.id))

    // ── Fire & forget — do NOT await ──────────────────────────────────────────
    // Returns to client in <3s total. Insertion continues in background.
    insertBackground(report.id, orders).catch(console.error)

    return NextResponse.json({
      reportId:    report.id,
      filename:    file.name,
      totalRows:   rows.length,
      insertedAt:  report.uploadedAt,
    })

  } catch (e) {
    console.error('[upload]', e)
    return NextResponse.json({ error: 'Import échoué. Vérifiez le format du fichier.' }, { status: 500 })
  }
}
