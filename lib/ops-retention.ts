/**
 * lib/ops-retention.ts — rétention des tables techniques (Sprint 18, audit D12 / Annexe C §3.4).
 * Suppression PAR LOTS (BATCH_SIZE lignes max par passage et par table) : on sélectionne des ids puis deleteMany({id:{in}})
 * — jamais de DELETE géant (pas de long verrou).
 *
 * JAMAIS purgés (conservation légale / paie / historique) : OpsAuditLog (trigger append-only), OpsOrder, OpsOrderEvent,
 * OpsPayRun*, DriverAttendance. Ce module ne les référence volontairement pas.
 */

/** Durées de conservation (en jours) — constantes exportées. */
export const RETENTION_DAYS = {
  OpsSyncRun: 30,
  OpsSyncReject: 60,
  OpsNotifLog: 90,
  DeliveryAlert: 90,       // uniquement les alertes acquittées
  QrScanNonce: 7,
  OpsOutbox: 30,           // uniquement les éléments terminés (doneAt renseigné)
  ReliabilityScore: 180,   // en conservant toujours le dernier score de chaque livreur
  OpsProof: 180,           // photos de preuve (base64, lourdes) — lot réduit : PROOF_BATCH_SIZE
  OpsDriverAction: 90,     // journal d'idempotence des actions de l'application livreur
} as const

/** Taille maximale d'un lot (lignes supprimées par passage et par table). */
export const BATCH_SIZE = 5000

/** Lot réduit pour OpsProof : chaque ligne porte une image base64 (suppression plus lourde). */
export const PROOF_BATCH_SIZE = 500

const DAY_MS = 86_400_000

/** Date limite : tout ce qui est antérieur (strictement) est éligible à la purge. Fonction pure. */
export function cutoffDate(days: number, nowMs: number = Date.now()): Date {
  return new Date(nowMs - days * DAY_MS)
}

/** Seuils de date de toutes les tables purgées. Fonction pure. */
export function retentionCutoffs(nowMs: number = Date.now()): Record<keyof typeof RETENTION_DAYS, Date> {
  const out = {} as Record<keyof typeof RETENTION_DAYS, Date>
  for (const k of Object.keys(RETENTION_DAYS) as (keyof typeof RETENTION_DAYS)[]) out[k] = cutoffDate(RETENTION_DAYS[k], nowMs)
  return out
}

/**
 * Parmi des scores `{id, driverName, calculatedAt}`, ids du plus récent de chaque livreur (à conserver). Fonction pure.
 */
export function latestScoreIds(rows: { id: string; driverName: string; calculatedAt: Date }[]): Set<string> {
  const best = new Map<string, { id: string; at: number }>()
  for (const r of rows) {
    const at = r.calculatedAt.getTime()
    const cur = best.get(r.driverName)
    if (!cur || at > cur.at) best.set(r.driverName, { id: r.id, at })
  }
  return new Set([...best.values()].map(v => v.id))
}

export type RetentionSummary = Record<string, number>

/** Un passage de purge (au plus BATCH_SIZE lignes par table). Une table en erreur n'empêche pas les autres. */
export async function runRetention(nowMs: number = Date.now()): Promise<RetentionSummary> {
  // Import dynamique : les fonctions pures ci-dessus restent testables sans client Prisma
  const { prisma } = await import('@/lib/prisma')
  const c = retentionCutoffs(nowMs)
  const summary: RetentionSummary = {}

  const step = async (table: string, fn: () => Promise<number>) => {
    try { summary[table] = await fn() }
    catch (e) { summary[table] = -1; console.error(`[retention] ${table}`, e) }
  }

  await step('OpsSyncRun', async () => {
    const rows = await prisma.opsSyncRun.findMany({ where: { startedAt: { lt: c.OpsSyncRun } }, select: { id: true }, take: BATCH_SIZE })
    return rows.length ? (await prisma.opsSyncRun.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })).count : 0
  })
  await step('OpsSyncReject', async () => {
    const rows = await prisma.opsSyncReject.findMany({ where: { createdAt: { lt: c.OpsSyncReject } }, select: { id: true }, take: BATCH_SIZE })
    return rows.length ? (await prisma.opsSyncReject.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })).count : 0
  })
  await step('OpsNotifLog', async () => {
    const rows = await prisma.opsNotifLog.findMany({ where: { createdAt: { lt: c.OpsNotifLog } }, select: { id: true }, take: BATCH_SIZE })
    return rows.length ? (await prisma.opsNotifLog.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })).count : 0
  })
  await step('DeliveryAlert', async () => {
    const rows = await prisma.deliveryAlert.findMany({ where: { acknowledged: true, createdAt: { lt: c.DeliveryAlert } }, select: { id: true }, take: BATCH_SIZE })
    return rows.length ? (await prisma.deliveryAlert.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })).count : 0
  })
  await step('QrScanNonce', async () => {
    const rows = await prisma.qrScanNonce.findMany({ where: { usedAt: { lt: c.QrScanNonce } }, select: { nonce: true }, take: BATCH_SIZE })
    return rows.length ? (await prisma.qrScanNonce.deleteMany({ where: { nonce: { in: rows.map(r => r.nonce) } } })).count : 0
  })
  await step('OpsOutbox', async () => {
    const rows = await prisma.opsOutbox.findMany({ where: { doneAt: { not: null, lt: c.OpsOutbox } }, select: { id: true }, take: BATCH_SIZE })
    return rows.length ? (await prisma.opsOutbox.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })).count : 0
  })
  await step('ReliabilityScore', async () => {
    // Dernier score de chaque livreur : toujours conservé, même s'il est plus vieux que le seuil
    const latest = await prisma.reliabilityScore.findMany({
      orderBy: [{ driverName: 'asc' }, { calculatedAt: 'desc' }], distinct: ['driverName'], select: { id: true },
    })
    const keep = latest.map(r => r.id)
    const rows = await prisma.reliabilityScore.findMany({
      where: { calculatedAt: { lt: c.ReliabilityScore }, id: { notIn: keep } }, select: { id: true }, take: BATCH_SIZE,
    })
    return rows.length ? (await prisma.reliabilityScore.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })).count : 0
  })

  await step('OpsProof', async () => {
    const rows = await prisma.opsProof.findMany({ where: { createdAt: { lt: c.OpsProof } }, select: { id: true }, take: PROOF_BATCH_SIZE })
    return rows.length ? (await prisma.opsProof.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })).count : 0
  })
  await step('OpsDriverAction', async () => {
    const rows = await prisma.opsDriverAction.findMany({ where: { createdAt: { lt: c.OpsDriverAction } }, select: { id: true }, take: BATCH_SIZE })
    return rows.length ? (await prisma.opsDriverAction.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })).count : 0
  })

  return summary
}
