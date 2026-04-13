import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    // Fetch tenant coefficients (fallback to defaults if not available)
    const session = await getSession(req)
    let coeffDelivery = 0.4
    let coeffAcademy  = 0.3
    let coeffNoShow   = 0.3

    if (session?.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: { scoreCoeffDelivery: true, scoreCoeffAcademy: true, scoreCoeffNoShow: true },
      })
      if (tenant) {
        coeffDelivery = tenant.scoreCoeffDelivery ?? 0.4
        coeffAcademy  = tenant.scoreCoeffAcademy  ?? 0.3
        coeffNoShow   = tenant.scoreCoeffNoShow   ?? 0.3
      }
    }

    // Get the active report
    const report = await prisma.deliveryReport.findFirst({
      where: { isActive: true },
      orderBy: { uploadedAt: 'desc' },
    })
    if (!report) {
      return NextResponse.json({ error: 'No active report found' }, { status: 404 })
    }

    // Aggregate per livreur
    const orders = await prisma.deliveryOrder.findMany({
      where: { reportId: report.id },
      select: {
        livreurFirstName: true,
        livreurLastName:  true,
        shippingWorkflowStatus: true,
      },
    })

    // Group by livreur name
    const livreurMap = new Map<string, { total: number; delivered: number; noShow: number }>()
    for (const o of orders) {
      const name = [o.livreurFirstName, o.livreurLastName].filter(Boolean).join(' ').trim()
      if (!name) continue
      const s = livreurMap.get(name) ?? { total: 0, delivered: 0, noShow: 0 }
      s.total++
      const status = (o.shippingWorkflowStatus ?? '').toUpperCase()
      if (status.includes('DELIVERED') || status === 'LIVRÉ' || status.includes('LIVRE')) s.delivered++
      if (status.includes('NO_SHOW') || status.includes('NOSHOW') || status === 'NO SHOW') s.noShow++
      livreurMap.set(name, s)
    }

    const created: string[] = []
    for (const [name, stats] of livreurMap.entries()) {
      if (stats.total < 3) continue // skip drivers with too few orders
      const deliveryRate = stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0
      const noShowRate   = stats.total > 0 ? (stats.noShow   / stats.total) * 100 : 0
      const academyScore = 0 // will be updated when Academy data is available
      const score = deliveryRate * coeffDelivery + academyScore * coeffAcademy + (100 - noShowRate) * coeffNoShow

      // Determine recommendation
      let recommendation: string | null = null
      if (score < 60)         recommendation = 'Formation Academy recommandée — score critique'
      else if (noShowRate > 20) recommendation = 'Taux NO_SHOW élevé — suivi requis'
      else if (deliveryRate < 70) recommendation = 'Taux de livraison insuffisant — coaching recommandé'

      await prisma.reliabilityScore.create({
        data: { driverName: name, deliveryRate, academyScore, noShowRate, score, recommendation },
      })

      // Auto-create alert if score < 60 or NO_SHOW > 20%
      if (score < 60) {
        const existing = await prisma.alert.findFirst({
          where: { title: { contains: name }, status: { not: 'resolved' }, type: 'auto' },
        })
        if (!existing) {
          await prisma.alert.create({
            data: {
              type: 'auto', severity: 'critical',
              title: `Score IA critique — ${name}`,
              description: `Score de fiabilité ${score.toFixed(1)}/100. Livraison: ${deliveryRate.toFixed(1)}%, NO_SHOW: ${noShowRate.toFixed(1)}%`,
              metricValue: score, threshold: 60,
            },
          })
        }
      }
      created.push(name)
    }

    return NextResponse.json({ calculated: created.length, drivers: created })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
