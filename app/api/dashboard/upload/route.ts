import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { COLUMN_MAP } from '@/lib/excel-mapping'
import { toMoroccoTime } from '@/lib/timezone'

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

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const XLSX = await import('xlsx')
    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

    const report = await prisma.deliveryReport.create({
      data: { filename: file.name },
    })

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

    await prisma.deliveryOrder.createMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: orders as any,
      skipDuplicates: true,
    })

    return NextResponse.json({
      reportId: report.id,
      filename: file.name,
      totalRows: orders.length,
      insertedAt: report.uploadedAt,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
