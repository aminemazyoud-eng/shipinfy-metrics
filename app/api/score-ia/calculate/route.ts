import { NextResponse } from 'next/server'
import { CFG } from '@/lib/ops-config'
import { applyOpsSettings } from '@/lib/ops-settings'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  await applyOpsSettings() // seuils de scoring paramétrables (Paramétrage → Calculs & équations)
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

    // Optional body { reportId } → use that report instead of the active one
    let bodyReportId: string | undefined
    try {
      const body = await req.json() as { reportId?: string } | null
      bodyReportId = body?.reportId || undefined
    } catch {
      bodyReportId = undefined
    }

    let report: { id: string } | null
    if (bodyReportId) {
      report = await prisma.deliveryReport.findUnique({
        where: { id: bodyReportId },
        select: { id: true },
      })
    } else {
      report = await prisma.deliveryReport.findFirst({
        where: { isActive: true },
        orderBy: { uploadedAt: 'desc' },
        select: { id: true },
      })
    }
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

    // Academy Score — moyenne des scores de formation Course/CourseProgress du livreur
    // (jointure par nom, faute d'un lien direct Driver ↔ DeliveryOrder)
    const drivers = await prisma.driver.findMany({
      select: {
        firstName: true,
        lastName:  true,
        courseProgress: { select: { score: true, certified: true } },
      },
    })
    const academyScoreMap = new Map<string, number>()
    for (const d of drivers) {
      const name = `${d.firstName} ${d.lastName}`.trim().toLowerCase()
      if (!name || d.courseProgress.length === 0) continue
      const avg = d.courseProgress.reduce((sum, p) => sum + (p.score ?? (p.certified ? 100 : 0)), 0) / d.courseProgress.length
      academyScoreMap.set(name, avg)
    }

    const created: string[] = []
    for (const [name, stats] of livreurMap.entries()) {
      if (stats.total < 3) continue // skip drivers with too few orders
      const deliveryRate = stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0
      const noShowRate   = stats.total > 0 ? (stats.noShow   / stats.total) * 100 : 0

      // Sprint 19 — tant que l'Academy n'a aucun contenu/progression pour ce
      // livreur, le noter 0% sur 30% du score le plafonnait artificiellement
      // (~70/100 max). On renormalise les 2 autres coefficients à 100% au lieu
      // de pénaliser un livreur pour une formation qui n'existe pas encore.
      const hasAcademyData = academyScoreMap.has(name.trim().toLowerCase())
      const academyScore   = academyScoreMap.get(name.trim().toLowerCase()) ?? 0
      const remainder       = coeffDelivery + coeffNoShow
      const effDelivery = hasAcademyData ? coeffDelivery : (remainder > 0 ? coeffDelivery / remainder : 0.5)
      const effNoShow   = hasAcademyData ? coeffNoShow   : (remainder > 0 ? coeffNoShow   / remainder : 0.5)
      const effAcademy  = hasAcademyData ? coeffAcademy  : 0
      const score = deliveryRate * effDelivery + academyScore * effAcademy + (100 - noShowRate) * effNoShow

      // Determine recommendation
      let recommendation: string | null = null
      if (score < CFG.scoreCritical) recommendation = 'Formation Academy recommandée — score critique'
      else if (noShowRate > 20) recommendation = 'Taux NO_SHOW élevé — suivi requis'
      else if (deliveryRate < 70) recommendation = 'Taux de livraison insuffisant — coaching recommandé'

      await prisma.reliabilityScore.create({
        data: { driverName: name, deliveryRate, academyScore, noShowRate, score, recommendation },
      })

      // Auto-create alert if score < 60 or NO_SHOW > 20%
      if (score < CFG.scoreCritical) {
        const existing = await prisma.alert.findFirst({
          where: { title: { contains: name }, status: { not: 'resolved' }, type: 'auto' },
        })
        if (!existing) {
          await prisma.alert.create({
            data: {
              type: 'auto', severity: 'critical',
              title: `Score IA critique — ${name}`,
              description: `Score de fiabilité ${score.toFixed(1)}/100. Livraison: ${deliveryRate.toFixed(1)}%, NO_SHOW: ${noShowRate.toFixed(1)}%`,
              metricValue: score, threshold: CFG.scoreCritical,
            },
          })
        }
      }
      created.push(name)
    }

    // Une seule source de vérité : on retire les scores de livreurs absents du rapport utilisé (anciens imports Excel, par ex.)
    let purged = 0
    if (created.length > 0) purged = (await prisma.reliabilityScore.deleteMany({ where: { driverName: { notIn: created } } })).count

    return NextResponse.json({ calculated: created.length, drivers: created, purged, reportId: report.id })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
