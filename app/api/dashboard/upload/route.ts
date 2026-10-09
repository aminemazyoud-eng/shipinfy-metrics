import { requireSession } from '@/lib/api-guard'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { COLUMN_MAP } from '@/lib/excel-mapping'
import { toMoroccoTime } from '@/lib/timezone'
import { trackUpload } from '@/lib/upload-progress'
import { validateUploadFile, parseSpreadsheetRows } from '@/lib/xlsx-import'

export const maxDuration = 60

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
  const _guard = await requireSession(request, 'MANAGER'); if ('error' in _guard) return _guard.error
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })


    // Taille max 10 Mo (contrôlée avant lecture), puis signature ZIP « PK » (.xlsx) ; .xls binaire refusé.
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Fichier trop volumineux (10 Mo maximum).' }, { status: 413 })
    const buffer = Buffer.from(await file.arrayBuffer())
    const check = validateUploadFile(file.name, buffer)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })
    let rows: Record<string, unknown>[]
    try {
      rows = await parseSpreadsheetRows(buffer, check.kind)
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
