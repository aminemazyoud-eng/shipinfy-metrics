#!/usr/bin/env node
'use strict'
// Remise à zéro de la flotte : supprime pleins, entretiens et missions, remet les compteurs km à 0,
// puis renseigne des documents de démonstration (permis, visite médicale, vignette…) pour tester les alertes.
// Usage : node --env-file=.env.local scripts/reset-fleet.js
const { PrismaClient } = require('../node_modules/@prisma/client')
const prisma = new PrismaClient()
const DAY = 86_400_000

async function main() {
  const f = await prisma.opsFuelLog.deleteMany()
  const m = await prisma.opsMaintenance.deleteMany()
  const k = await prisma.opsMission.deleteMany()
  const v = await prisma.opsVehicle.updateMany({ data: { odometerKm: 0 } })
  console.log(`[reset-fleet] ${f.count} pleins, ${m.count} entretiens, ${k.count} missions supprimés · ${v.count} compteurs remis à 0`)

  // Documents de démonstration (quelques-uns proches de l'échéance pour voir les alertes)
  const people = await prisma.opsDriver.findMany({ orderBy: { code: 'asc' } })
  for (const [i, p] of people.entries()) {
    const soon = i % 7 === 3
    await prisma.opsDriver.update({ where: { id: p.id }, data: {
      licenseCategory: p.jobType === 'chauffeur' ? (i % 3 === 0 ? 'C1' : 'B') : null,
      licenseExpiry: p.jobType === 'chauffeur' ? new Date(Date.now() + (soon ? 12 : 200 + i * 23) * DAY) : null,
      medicalVisitExpiry: new Date(Date.now() + (soon ? 20 : 120 + i * 17) * DAY),
    } })
  }
  const vehicles = await prisma.opsVehicle.findMany({ orderBy: { plate: 'asc' } })
  for (const [i, v2] of vehicles.entries()) {
    await prisma.opsVehicle.update({ where: { id: v2.id }, data: { vignetteExpiry: new Date(Date.now() + (i % 6 === 2 ? 9 : 150 + i * 13) * DAY) } })
  }
  console.log(`[reset-fleet] documents de démonstration : ${people.length} personnes, ${vehicles.length} véhicules`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
