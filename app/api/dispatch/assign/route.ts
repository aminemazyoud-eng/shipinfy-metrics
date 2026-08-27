import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeAssignmentScore, balanceLoad } from '@/lib/dispatch-engine'
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

// Same DriverStatus[] builder as /api/dispatch/drivers-status (duplicated on
// purpose — route files can't cleanly share non-handler exports).
async function buildDriversStatus(reportId: string): Promise<DriverStatus[]> {
  const orders = await prisma.deliveryOrder.findMany({
    where: { reportId },
    select: {
      shippingWorkflowStatus: true,
      deliveryTimeEnd:        true,
      livreurFirstName:       true,
      livreurLastName:        true,
      sprintName:             true,
    },
  })

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
    const deadlines = active
      .map(o => o.deliveryTimeEnd?.getTime())
      .filter((t): t is number => typeof t === 'number')
    let lastDeliveryEta = 0
    if (deadlines.length > 0) {
      lastDeliveryEta = Math.max(0, Math.round((Math.max(...deadlines) - now) / 60000))
    }
    return {
      driverName,
      currentOrders:   active.length,
      lastDeliveryEta,
      distanceToStore: 0,
      scoreIA:         scoreByName.get(driverName) ?? 0,
    }
  }).sort((a, b) => b.currentOrders - a.currentOrders)
}

// POST /api/dispatch/assign
// body: { reportId: string, orderId?: string, orderCount?: number }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      reportId?: string
      orderId?: string
      orderCount?: number
    }
    const { reportId, orderId } = body
    if (!reportId) return NextResponse.json({ error: 'reportId requis' }, { status: 400 })

    const drivers = await buildDriversStatus(reportId)
    if (drivers.length === 0) {
      return NextResponse.json({ assignments: [], note: 'Aucun livreur sur ce rapport' })
    }

    // Single order → best driver
    if (orderId) {
      const best = drivers
        .map(d => computeAssignmentScore(d))
        .sort((a, b) => a.score - b.score)[0]
      return NextResponse.json({
        assignments: [{ orderId, driverName: best.driverName, score: best.score, reason: best.reason }],
        note: 'Assignation conseillée — non persistée (pas de modèle Assignment en base)',
      })
    }

    // Bulk → balance load across N slots
    let n = body.orderCount
    if (typeof n !== 'number' || n <= 0) {
      n = await prisma.deliveryOrder.count({
        where: { reportId, shippingWorkflowStatus: { notIn: [...FINISHED] } },
      })
    }

    const picks = balanceLoad(drivers, n)
    const byName = new Map(drivers.map(d => [d.driverName, d]))
    const running = new Map<string, number>(drivers.map(d => [d.driverName, d.currentOrders]))

    const assignments = picks.map(driverName => {
      const base = byName.get(driverName)!
      const live = { ...base, currentOrders: running.get(driverName) ?? base.currentOrders }
      const s = computeAssignmentScore(live)
      running.set(driverName, (running.get(driverName) ?? 0) + 1)
      return { orderId: null as string | null, driverName, score: s.score, reason: s.reason }
    })

    return NextResponse.json({
      assignments,
      note: 'Assignation conseillée — non persistée (pas de modèle Assignment en base)',
    })
  } catch (e) {
    console.error('[api/dispatch/assign POST]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
