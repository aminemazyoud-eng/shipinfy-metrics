/**
 * lib/ops-import-db.ts — enregistrement des commandes importées depuis un fichier d'export (scénario B).
 * Les commandes sont rangées sous la source « import » (jamais mélangées à l'API) ; la clé est la référence de la commande.
 * Conçu pour un envoi AUTOMATIQUE toutes les 5 minutes : on n'écrit que ce qui a changé (nouvelles commandes + commandes modifiées),
 * un export complet inchangé ne produit donc aucune écriture. Deux envois simultanés sont refusés (verrou par ligne OpsSyncRun).
 * Les magasins du fichier sont créés INACTIFS (code « IMP:… ») : ils servent au Dashboard (nom + GPS pour les distances) sans apparaître dans le Cockpit.
 */
import { prisma } from '@/lib/prisma'
import { canonicalSlot } from '@/lib/ops-slots'
import { IMPORT_SOURCE, IMPORT_HUB_PREFIX, diffImport, type ImportMapping, type ImportedOrder } from '@/lib/ops-import'

const CHUNK = 1000
const LOCK_MS = 3 * 60_000 // un import non terminé depuis plus de 3 min est considéré comme mort

export class ImportBusyError extends Error { constructor() { super('Un import est déjà en cours, réessayez dans quelques instants.') } }

const row = (o: ImportedOrder) => ({
  source: IMPORT_SOURCE, externalId: o.externalId, reference: o.externalId, hubCode: o.hubCode, status: o.status,
  slotStart: o.slotStart, slotEnd: o.slotEnd, slotLabel: canonicalSlot(o.slotStart), amount: o.amount,
  customerName: o.customerName, customerPhone: o.customerPhone, lat: o.lat, lng: o.lng, attemptCount: o.attemptCount, courierRef: o.courierRef,
  createdAtSrc: o.createdAtSrc, assignedAt: o.assignedAt, inTransportAt: o.inTransportAt, startDeliveryAt: o.startDeliveryAt,
  deliveredAt: o.deliveredAt, noShowAt: o.noShowAt, sourceUpdatedAt: o.sourceUpdatedAt,
})

export interface SaveResult { inserted: number; replaced: number; unchanged: number; runId: string }

export async function saveImport(m: ImportMapping): Promise<SaveResult> {
  // Verrou : une ligne « en cours » récente = un autre import travaille
  const busy = await prisma.opsSyncRun.findFirst({ where: { source: IMPORT_SOURCE, finishedAt: null, startedAt: { gt: new Date(Date.now() - LOCK_MS) } }, select: { id: true } })
  if (busy) throw new ImportBusyError()
  const run = await prisma.opsSyncRun.create({ data: { source: IMPORT_SOURCE, fetched: m.unique, ok: false } })
  try {
    for (const h of m.hubs) {
      await prisma.opsHub.upsert({
        where: { code: h.code },
        create: { code: h.code, name: h.name, city: 'IMPORT', lat: h.lat, lng: h.lng, active: false },
        update: { name: h.name, ...(h.lat !== null && h.lng !== null ? { lat: h.lat, lng: h.lng } : {}) }, // ne réactive jamais un magasin
      })
    }
    let inserted = 0, replaced = 0, unchanged = 0
    for (let i = 0; i < m.orders.length; i += CHUNK) {
      const part = m.orders.slice(i, i + CHUNK)
      const existing = await prisma.opsOrder.findMany({
        where: { source: IMPORT_SOURCE, externalId: { in: part.map(o => o.externalId) } },
        select: { externalId: true, status: true, sourceUpdatedAt: true, courierRef: true, attemptCount: true, amount: true, assignedAt: true, inTransportAt: true, startDeliveryAt: true, deliveredAt: true },
      })
      const d = diffImport(existing, part)
      unchanged += d.unchanged
      if (d.toReplace.length || d.toInsert.length) {
        await prisma.$transaction([
          ...(d.toReplace.length ? [prisma.opsOrder.deleteMany({ where: { source: IMPORT_SOURCE, externalId: { in: d.toReplace.map(o => o.externalId) } } })] : []),
          prisma.opsOrder.createMany({ data: [...d.toInsert, ...d.toReplace].map(row), skipDuplicates: true }),
        ])
      }
      inserted += d.toInsert.length; replaced += d.toReplace.length
    }
    const now = new Date()
    if (inserted + replaced === 0) {
      // Rien n'a changé : on « touche » le dernier import (la fraîcheur affichée reste juste) au lieu d'empiler une ligne toutes les 5 min
      const last = await prisma.opsSyncRun.findFirst({ where: { source: IMPORT_SOURCE, ok: true, id: { not: run.id } }, orderBy: { startedAt: 'desc' }, select: { id: true } })
      if (last) { await prisma.opsSyncRun.update({ where: { id: last.id }, data: { finishedAt: now, fetched: m.unique } }); await prisma.opsSyncRun.delete({ where: { id: run.id } }); return { inserted, replaced, unchanged, runId: last.id } }
    }
    await prisma.opsSyncRun.update({ where: { id: run.id }, data: { finishedAt: now, created: inserted, updated: replaced, ok: true } })
    return { inserted, replaced, unchanged, runId: run.id }
  } catch (e) {
    await prisma.opsSyncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, error: e instanceof Error ? e.message.slice(0, 500) : String(e) } }).catch(() => {})
    throw e
  }
}

/** Supprime toutes les commandes importées (et les magasins créés par l'import). Les données de l'API ne sont jamais touchées. */
export async function purgeImport(): Promise<{ orders: number; hubs: number }> {
  const orders = await prisma.opsOrder.deleteMany({ where: { source: IMPORT_SOURCE } })
  const hubs = await prisma.opsHub.deleteMany({ where: { code: { startsWith: IMPORT_HUB_PREFIX } } })
  await prisma.opsSyncRun.deleteMany({ where: { source: IMPORT_SOURCE } })
  return { orders: orders.count, hubs: hubs.count }
}
