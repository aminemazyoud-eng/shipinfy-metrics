#!/usr/bin/env node
'use strict'
// Seed de l'organisation de test : 7 hubs · 23 livreurs · 23 véhicules (idempotent, upsert).
// Usage : node scripts/seed-ops.js     (nécessite DATABASE_URL ; tables créées par run-init-sql.js)
const { PrismaClient } = require('../node_modules/@prisma/client')
const { HUBS, buildDrivers } = require('../mock-backoffice/org')

const prisma = new PrismaClient()

async function main() {
  const hubId = {}
  for (const h of HUBS) {
    const row = await prisma.opsHub.upsert({
      where: { code: h.code },
      update: { name: h.name, city: h.city, lat: h.lat, lng: h.lng },
      create: { code: h.code, name: h.name, city: h.city, lat: h.lat, lng: h.lng },
    })
    hubId[h.code] = row.id
  }

  let n = 0
  for (const d of buildDrivers()) {
    const vehicle = await prisma.opsVehicle.upsert({
      where: { plate: d.vehicle.plate },
      update: { type: d.vehicle.type, fuelType: d.vehicle.fuelType, capacityKg: d.vehicle.capacityKg, consumptionL100: d.vehicle.consumptionL100 },
      create: { ...d.vehicle, hubId: hubId[d.hubCode] },
    })
    await prisma.opsDriver.upsert({
      where: { code: d.code },
      // update : ne touche PAS hubId (un switch de hub fait depuis l'app doit survivre à un re-seed)
      update: { firstName: d.firstName, lastName: d.lastName, phone: d.phone },
      create: {
        code: d.code, firstName: d.firstName, lastName: d.lastName, phone: d.phone,
        hubId: hubId[d.hubCode], homeHubId: hubId[d.hubCode], vehicleId: vehicle.id,
        payMode: 'fixed', dailyRate: 150, bonusPerOrder: 0,
      },
    })
    n++
  }
  console.log(`[seed-ops] ${HUBS.length} hubs, ${n} livreurs, ${n} véhicules`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
