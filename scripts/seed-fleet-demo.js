#!/usr/bin/env node
'use strict'
// Données de démonstration flotte : pleins (30 j) + entretiens pour chaque véhicule — idempotent (saute les véhicules déjà renseignés).
// Usage : node --env-file=.env.local scripts/seed-fleet-demo.js
const { PrismaClient } = require('../node_modules/@prisma/client')
const prisma = new PrismaClient()
const DAY = 86_400_000
const PRICE = { diesel: 11.4, essence: 13.6 }

function rng(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296 } }

async function main() {
  const vehicles = await prisma.opsVehicle.findMany({ orderBy: { plate: 'asc' } })
  let n = 0
  for (const [i, v] of vehicles.entries()) {
    if (await prisma.opsFuelLog.count({ where: { vehicleId: v.id } })) continue
    const r = rng(1000 + i * 77)
    const cons = v.consumptionL100 ?? 8
    const drift = 0.9 + r() * 0.45 // certains véhicules consomment plus que la théorie (alertes)
    let odo = 18000 + Math.round(r() * 60000)
    for (let d = 30; d >= 0; d -= 3 + Math.floor(r() * 2)) {
      const km = Math.round(190 + r() * 120) // ≈ 3 jours de tournées
      odo += km
      const liters = Math.round(((km * cons * drift) / 100) * 10) / 10
      await prisma.opsFuelLog.create({ data: { vehicleId: v.id, date: new Date(Date.now() - d * DAY), liters, amountMad: Math.round(liters * (PRICE[v.fuelType] ?? 11.4) * 100) / 100, odometerKm: odo, station: ['Afriquia', 'Total', 'Shell', 'Petrom'][Math.floor(r() * 4)] } })
    }
    await prisma.opsVehicle.update({ where: { id: v.id }, data: { odometerKm: odo } })
    await prisma.opsMaintenance.create({ data: { vehicleId: v.id, date: new Date(Date.now() - 40 * DAY), type: 'vidange', costMad: v.type === 'moto' ? 180 : 650, odometerKm: odo - 700, nextDueKm: odo + (i % 4 === 0 ? 300 : 4000), notes: 'Vidange + filtre' } })
    if (i % 5 === 0) await prisma.opsMaintenance.create({ data: { vehicleId: v.id, date: new Date(Date.now() - 12 * DAY), type: 'assurance', costMad: 2400, nextDueDate: new Date(Date.now() + (i % 10 === 0 ? 6 : 90) * DAY) } })
    n++
  }
  console.log(`[seed-fleet-demo] ${n} véhicule(s) renseigné(s)`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
