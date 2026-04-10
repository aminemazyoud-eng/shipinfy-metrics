import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { COLUMN_MAP } from '@/lib/excel-mapping'
import { toMoroccoTime } from '@/lib/timezone'

export const maxDuration = 300 // 5 min hint for self-hosted

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

async function insertBatch(batch: Record<string, unknown>[]) {
  await prisma.deliveryOrder.createMany({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: batch as any,
    skipDuplicates: true,
  })
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    // Client-side already filters .xlsx/.xls but double-check
    const name = file.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      return NextResponse.json({ error: 'Format non supporté (.xlsx/.xls uniquement)' }, { status: 400 })
    }

    const XLSX = await import('xlsx')
    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Le fichier ne contient aucune ligne de données.' }, { status: 400 })
    }

    const report = await prisma.deliveryReport.create({
      data: { filename: file.name },
    })

    // Map all rows
    const orders = rows.map((row) => {
      const order: Record<string, unknown> = { reportId: report.id }
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
    })

    // Insert in batches of 500 to avoid DB timeouts on large files
    const BATCH_SIZE = 500
    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      await insertBatch(orders.slice(i, i + BATCH_SIZE))
    }

    return NextResponse.json({
      reportId: report.id,
      filename: file.name,
      totalRows: orders.length,
      insertedAt: report.uploadedAt,
    })
  } catch (e) {
    console.error('[upload]', e)
    return NextResponse.json({ error: 'Import échoué. Vérifiez le format du fichier.' }, { status: 500 })
  }
}
