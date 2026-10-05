// Rattrapage : complète le parcours des commandes déjà en base (aucune étape sautée).
// Usage : node --env-file=.env.local scripts/backfill-steps.mjs [--dry]
// Idempotent : ne crée que les événements d'étape manquants (source « inferred » si l'horodatage est estimé).
import { PrismaClient } from '@prisma/client'
import { fillChain } from '../lib/ops-chain.ts'

const dry = process.argv.includes('--dry')
const prisma = new PrismaClient()
const BATCH = 500
let cursor = null, scanned = 0, orders = 0, created = 0, inferred = 0

for (;;) {
  const rows = await prisma.opsOrder.findMany({
    take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: 'asc' }, where: { status: { not: 'READY_PICKUP' } },
    select: { id: true, status: true, createdAtSrc: true, assignedAt: true, inTransportAt: true, startDeliveryAt: true, deliveredAt: true, noShowAt: true, events: { select: { toStatus: true, at: true } } },
  })
  if (!rows.length) break
  cursor = rows[rows.length - 1].id
  const data = []
  for (const o of rows) {
    scanned++
    const known = [
      ...o.events.filter(e => e.toStatus !== 'COLLECTED').map(e => ({ status: e.toStatus, at: e.at })),
      ...[['READY_PICKUP', o.createdAtSrc], ['ASSIGNED', o.assignedAt], ['IN_TRANSPORT', o.inTransportAt], ['START_DELIVERY', o.startDeliveryAt], ['DELIVERED', o.deliveredAt], ['NO_SHOW', o.noShowAt]].filter(([, at]) => at).map(([status, at]) => ({ status, at })),
    ]
    const chain = fillChain(known, o.status)
    const have = new Set(o.events.map(e => e.toStatus))
    let prev = null, added = 0
    for (const c of chain) {
      if (!have.has(c.status)) { data.push({ orderId: o.id, fromStatus: prev, toStatus: c.status, at: c.at, source: c.inferred ? 'inferred' : 'sync' }); added++; if (c.inferred) inferred++ }
      prev = c.status
    }
    if (added) orders++
  }
  created += data.length
  if (!dry && data.length) await prisma.opsOrderEvent.createMany({ data })
}
console.log(`${dry ? '[simulation] ' : ''}${scanned} commandes examinées · ${orders} complétées · ${created} étapes ajoutées (dont ${inferred} estimées)`)
await prisma.$disconnect()
