/**
 * lib/score-ia-engine.ts — calcul du Score IA (fiabilité livreurs) — Sprint 17 B5.
 * Logique extraite de app/api/score-ia/calculate/route.ts pour être appelée DIRECTEMENT par la route (qui garde sa garde
 * d'authentification) ET par le cron de 02:00 (plus de fetch HTTP sans session, qui échouait silencieusement).
 */
import { CFG } from '@/lib/ops-config'
import { applyOpsSettings } from '@/lib/ops-settings'
import { prisma } from '@/lib/prisma'

/** Version de la formule de score (à incrémenter à chaque changement de calcul) — stockée dans chaque ligne ReliabilityScore. */
export const SCORE_VERSION = 1

export interface ScoreResult {
  ok: boolean
  /** 404 si aucun rapport actif / trouvé */
  status: number
  error?: string
  calculated: number
  drivers: string[]
  /** Toujours 0 : l'historique n'est plus purgé ici (la rétention nocturne s'en charge). Conservé pour compatibilité de l'API. */
  purged: number
  reportId?: string
  scoreVersion?: number
}

/**
 * Calcule les scores de fiabilité sur le rapport indiqué (sinon le rapport actif le plus récent).
 * `tenantId` : coefficients du tenant (défaut 0,4 / 0,3 / 0,3).
 */
export async function calculateScores(opts: { reportId?: string; tenantId?: string | null } = {}): Promise<ScoreResult> {
  await applyOpsSettings() // seuils de scoring paramétrables (Paramétrage → Calculs & équations)

  let coeffDelivery = 0.4
  let coeffAcademy  = 0.3
  let coeffNoShow   = 0.3
  if (opts.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: opts.tenantId },
      select: { scoreCoeffDelivery: true, scoreCoeffAcademy: true, scoreCoeffNoShow: true },
    })
    if (tenant) {
      coeffDelivery = tenant.scoreCoeffDelivery ?? 0.4
      coeffAcademy  = tenant.scoreCoeffAcademy  ?? 0.3
      coeffNoShow   = tenant.scoreCoeffNoShow   ?? 0.3
    }
  }

  const report = opts.reportId
    ? await prisma.deliveryReport.findUnique({ where: { id: opts.reportId }, select: { id: true } })
    : await prisma.deliveryReport.findFirst({ where: { isActive: true }, orderBy: { uploadedAt: 'desc' }, select: { id: true } })
  if (!report) return { ok: false, status: 404, error: 'No active report found', calculated: 0, drivers: [], purged: 0 }

  // Agrégation par livreur
  const orders = await prisma.deliveryOrder.findMany({
    where: { reportId: report.id },
    select: { livreurFirstName: true, livreurLastName: true, shippingWorkflowStatus: true },
  })
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

  // Academy Score — moyenne des scores de formation Course/CourseProgress du livreur (jointure par nom)
  const drivers = await prisma.driver.findMany({
    select: { firstName: true, lastName: true, courseProgress: { select: { score: true, certified: true } } },
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
    if (stats.total < 3) continue // trop peu de commandes
    const deliveryRate = stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0
    const noShowRate   = stats.total > 0 ? (stats.noShow   / stats.total) * 100 : 0

    // Sans donnée Academy, on renormalise les 2 autres coefficients à 100 % au lieu de pénaliser le livreur.
    const hasAcademyData = academyScoreMap.has(name.trim().toLowerCase())
    const academyScore   = academyScoreMap.get(name.trim().toLowerCase()) ?? 0
    const remainder      = coeffDelivery + coeffNoShow
    const effDelivery = hasAcademyData ? coeffDelivery : (remainder > 0 ? coeffDelivery / remainder : 0.5)
    const effNoShow   = hasAcademyData ? coeffNoShow   : (remainder > 0 ? coeffNoShow   / remainder : 0.5)
    const effAcademy  = hasAcademyData ? coeffAcademy  : 0
    const score = deliveryRate * effDelivery + academyScore * effAcademy + (100 - noShowRate) * effNoShow
    // Poids effectivement utilisés (après renormalisation éventuelle) — traçabilité de chaque score
    const coefficients = JSON.stringify({
      delivery: effDelivery, academy: effAcademy, noShow: effNoShow,
      academyDataAvailable: hasAcademyData,
      // Transparence : tout NO_SHOW est imputé au livreur (aucune donnée ne distingue l'absence du client)
      noShowCountedAgainstDriver: true,
    })

    let recommendation: string | null = null
    if (score < CFG.scoreCritical) recommendation = 'Formation Academy recommandée — score critique'
    else if (noShowRate > 20) recommendation = 'Taux NO_SHOW élevé — suivi requis'
    else if (deliveryRate < 70) recommendation = 'Taux de livraison insuffisant — coaching recommandé'

    await prisma.reliabilityScore.create({
      data: {
        driverName: name, deliveryRate, academyScore, noShowRate, score, recommendation,
        reportId: report.id, coefficients, ordersCount: stats.total, scoreVersion: SCORE_VERSION,
      },
    })

    // Alerte automatique si score critique
    if (score < CFG.scoreCritical) {
      // Clé exacte (titre complet, nom entier) : « Jean Dupont » ne masque plus l'alerte de « Jean Dupont-Martin »
      const alertTitle = `Score IA critique — ${name}`
      const existing = await prisma.alert.findFirst({ where: { title: alertTitle, status: { not: 'resolved' }, type: 'auto' } })
      if (!existing) {
        await prisma.alert.create({
          data: {
            type: 'auto', severity: 'critical',
            title: alertTitle,
            description: `Score de fiabilité ${score.toFixed(1)}/100. Livraison: ${deliveryRate.toFixed(1)}%, NO_SHOW: ${noShowRate.toFixed(1)}%`,
            metricValue: score, threshold: CFG.scoreCritical,
          },
        })
      }
    }
    created.push(name)
  }

  // Plus de purge destructrice : l'historique des livreurs absents du rapport est conservé (rétention : lib/ops-retention.ts)
  const purged = 0

  return { ok: true, status: 200, calculated: created.length, drivers: created, purged, reportId: report.id, scoreVersion: SCORE_VERSION }
}
