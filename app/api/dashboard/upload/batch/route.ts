import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { COLUMN_MAP } from '@/lib/excel-mapping'
import { toMoroccoTime } from '@/lib/timezone'

// Each individual batch is small (≤250 rows) → always completes in <10s.
// No Traefik / Dokploy reverse-proxy timeout issues.
export const maxDuration = 30

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
    const body = await request.json() as { reportId: string; rows: Record<string, unknown>[] }
    const { reportId, rows } = body

    if (!reportId || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'reportId et rows requis' }, { status: 400 })
    }

    const orders = rows.map((row) => {
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
    })

    await prisma.deliveryOrder.createMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: orders as any,
      skipDuplicates: true,
    })

    return NextResponse.json({ inserted: orders.length })
  } catch (e) {
    console.error('[upload/batch]', e)
    return NextResponse.json({ error: 'Insertion batch échouée' }, { status: 500 })
  }
}
