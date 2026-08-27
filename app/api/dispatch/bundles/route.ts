import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { detectBundles } from '@/lib/dispatch-engine'

export const runtime = 'nodejs'

const FINISHED = new Set(['DELIVERED', 'NO_SHOW', 'CANCELLED'])

// GET /api/dispatch/bundles?reportId=xxx&radius=500
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const reportId = searchParams.get('reportId')
    if (!reportId) return NextResponse.json({ error: 'reportId requis' }, { status: 400 })

    const radius = Number(searchParams.get('radius')) || 500

    const orders = await prisma.deliveryOrder.findMany({
      where: { reportId },
      select: {
        id:                    true,
        externalReference:     true,
        shippingWorkflowStatus:true,
        destinationLatitude:   true,
        destinationLongitude:  true,
        destinationCityCode:   true,
      },
    })

    const active = orders.filter(o => !FINISHED.has(o.shippingWorkflowStatus ?? ''))

    const refById = new Map(active.map(o => [o.id, o.externalReference ?? '—']))

    const input = active.map(o => ({
      id:      o.id,
      address: o.destinationCityCode ?? '',
      lat:     o.destinationLatitude ?? undefined,
      lng:     o.destinationLongitude ?? undefined,
      zone:    o.destinationCityCode ?? undefined,
    }))

    const { bundles } = detectBundles(input, radius)

    const enriched = bundles
      .filter(b => b.orderIds.length >= 2)
      .map(b => ({
        orderIds:        b.orderIds,
        zone:            b.zone,
        estimatedSaving: b.estimatedSaving,
        refs:            b.orderIds.map(id => refById.get(id) ?? '—'),
      }))
      .sort((a, b) => b.estimatedSaving - a.estimatedSaving)

    return NextResponse.json({ bundles: enriched })
  } catch (e) {
    console.error('[api/dispatch/bundles GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
