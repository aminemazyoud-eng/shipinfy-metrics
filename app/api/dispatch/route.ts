import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function livreurName(o: {
  livreurFirstName: string | null
  livreurLastName:  string | null
  sprintName:       string | null
}): string {
  const first = o.livreurFirstName?.trim()
  const last  = o.livreurLastName?.trim()
  if (first || last) return [first, last].filter(Boolean).join(' ')
  return o.sprintName ?? 'Inconnu'
}

// GET /api/dispatch?reportId=xxx&hub=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const reportId = searchParams.get('reportId')
    const hub      = searchParams.get('hub') ?? undefined

    if (!reportId) return NextResponse.json({ error: 'reportId requis' }, { status: 400 })

    const orders = await prisma.deliveryOrder.findMany({
      where: {
        reportId,
        ...(hub ? { originHubName: { contains: hub, mode: 'insensitive' } } : {}),
      },
      select: {
        id:                     true,
        externalReference:      true,
        shippingWorkflowStatus: true,
        deliveryTimeStart:      true,
        deliveryTimeEnd:        true,
        dateTimeWhenDelivered:  true,
        livreurFirstName:       true,
        livreurLastName:        true,
        sprintName:             true,
        originHubName:          true,
        destinationCityCode:    true,
        paymentOnDeliveryAmount:true,
      },
    })

    // Group by driver
    const driverMap = new Map<string, typeof orders>()
    for (const o of orders) {
      const name = livreurName(o)
      if (!driverMap.has(name)) driverMap.set(name, [])
      driverMap.get(name)!.push(o)
    }

    // Distinct hubs
    const hubs = [...new Set(orders.map(o => o.originHubName).filter(Boolean))] as string[]

    const STATUS_ORDER = ['DELIVERED', 'NO_SHOW', 'READY_PICKUP', 'OTHER']
    function statusGroup(s: string | null) {
      if (s === 'DELIVERED') return 'DELIVERED'
      if (s === 'NO_SHOW')   return 'NO_SHOW'
      if (s === 'READY_PICKUP') return 'READY_PICKUP'
      return 'OTHER'
    }

    const drivers = Array.from(driverMap.entries()).map(([driverName, dos]) => {
      const byStatus: Record<string, number> = { DELIVERED: 0, NO_SHOW: 0, READY_PICKUP: 0, OTHER: 0 }
      for (const o of dos) byStatus[statusGroup(o.shippingWorkflowStatus)]++

      const hub = dos[0]?.originHubName ?? 'Inconnu'
      const total = dos.length
      const done  = byStatus.DELIVERED + byStatus.NO_SHOW
      const pct   = total > 0 ? Math.round(done / total * 100) : 0

      // Recent orders (last 5, sorted by delivery time)
      const recent = [...dos]
        .sort((a, b) => {
          const ta = a.dateTimeWhenDelivered?.getTime() ?? a.deliveryTimeEnd?.getTime() ?? 0
          const tb = b.dateTimeWhenDelivered?.getTime() ?? b.deliveryTimeEnd?.getTime() ?? 0
          return tb - ta
        })
        .slice(0, 5)
        .map(o => ({
          id:        o.id,
          ref:       o.externalReference ?? '—',
          status:    o.shippingWorkflowStatus ?? 'UNKNOWN',
          city:      o.destinationCityCode ?? '—',
          cod:       o.paymentOnDeliveryAmount ?? 0,
          deadline:  o.deliveryTimeEnd?.toISOString() ?? null,
          delivered: o.dateTimeWhenDelivered?.toISOString() ?? null,
        }))

      return { driverName, hub, total, byStatus, pct, recent }
    }).sort((a, b) => b.total - a.total)

    const totals = orders.reduce(
      (s, o) => {
        const g = statusGroup(o.shippingWorkflowStatus)
        return { ...s, [g]: s[g] + 1, total: s.total + 1 }
      },
      { total: 0, DELIVERED: 0, NO_SHOW: 0, READY_PICKUP: 0, OTHER: 0 }
    )

    return NextResponse.json({ drivers, hubs, totals })
  } catch (e) {
    console.error('[api/dispatch GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
