import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { DriverStatus } from '@/lib/dispatch-engine'

export const runtime = 'nodejs'

const FINISHED = new Set(['DELIVERED', 'NO_SHOW', 'CANCELLED'])

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

// Build DriverStatus[] for a report. The same logic is duplicated in
// /api/dispatch/assign (route files can't cleanly share non-handler exports).
async function buildDriversStatus(reportId: string): Promise<DriverStatus[]> {
  const orders = await prisma.deliveryOrder.findMany({
    where: { reportId },
    select: {
      id:                     true,
      shippingWorkflowStatus: true,
      deliveryTimeEnd:        true,
      livreurFirstName:       true,
      livreurLastName:        true,
      sprintName:             true,
    },
  })

  // Latest ReliabilityScore per driverName (same dedup approach as /api/score-ia)
  const allScores = await prisma.reliabilityScore.findMany({ orderBy: { calculatedAt: 'desc' } })
  const scoreByName = new Map<string, number>()
  for (const s of allScores) {
    if (!scoreByName.has(s.driverName)) scoreByName.set(s.driverName, s.score)
  }

  const now = Date.now()
  const driverMap = new Map<string, typeof orders>()
  for (const o of orders) {
    const name = livreurName(o)
    if (!driverMap.has(name)) driverMap.set(name, [])
    driverMap.get(name)!.push(o)
  }

  return Array.from(driverMap.entries()).map(([driverName, dos]) => {
    const active = dos.filter(o => !FINISHED.has(o.shippingWorkflowStatus ?? ''))
    const currentOrders = active.length

    let lastDeliveryEta = 0
    const deadlines = active
      .map(o => o.deliveryTimeEnd?.getTime())
      .filter((t): t is number => typeof t === 'number')
    if (deadlines.length > 0) {
      const latest = Math.max(...deadlines)
      lastDeliveryEta = Math.max(0, Math.round((latest - now) / 60000))
    }

    return {
      driverName,
      currentOrders,
      lastDeliveryEta,
      distanceToStore: 0, // no GPS in this version
      scoreIA: scoreByName.get(driverName) ?? 0,
    }
  }).sort((a, b) => b.currentOrders - a.currentOrders)
}

// GET /api/dispatch/drivers-status?reportId=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const reportId = searchParams.get('reportId')
    if (!reportId) return NextResponse.json({ error: 'reportId requis' }, { status: 400 })

    const drivers = await buildDriversStatus(reportId)
    return NextResponse.json({ drivers, generatedAt: new Date().toISOString() })
  } catch (e) {
    console.error('[api/dispatch/drivers-status GET]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
