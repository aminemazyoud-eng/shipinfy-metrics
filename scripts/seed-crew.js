#!/usr/bin/env node
'use strict'
// Équipe par véhicule : 1 chauffeur (D01–D23, déjà seedés) + 1 helper (H01–H23) — idempotent.
// Remplit aussi les fiches de démonstration (CIN, date d'embauche, contrat). Usage : node --env-file=.env.local scripts/seed-crew.js
const { PrismaClient } = require('../node_modules/@prisma/client')
const prisma = new PrismaClient()

const HFIRST = ['Adil', 'Badr', 'Chakib', 'Fouad', 'Ismail', 'Jamal', 'Larbi', 'Mounir', 'Nadir', 'Oussama', 'Redouane', 'Sami', 'Taha', 'Younes', 'Zouhair', 'Abdou', 'Brahim', 'Hassan', 'Mustapha', 'Noureddine', 'Othmane', 'Saad', 'Tawfik']
const HLAST = ['Akhannouch', 'Bouazza', 'Cherkaoui', 'Doukkali', 'Essaidi', 'Filali', 'Ghazi', 'Hajji', 'Idrissi', 'Jabri', 'Kabbaj', 'Lamrani', 'Mernissi', 'Nejjar', 'Ouali', 'Qadiri', 'Raji', 'Sbai', 'Tahiri', 'Ouahbi', 'Yousfi', 'Zahraoui', 'Amine']
const DAY = 86_400_000

async function main() {
  const chauffeurs = await prisma.opsDriver.findMany({ where: { jobType: 'chauffeur' }, orderBy: { code: 'asc' } })
  let made = 0
  for (const [i, c] of chauffeurs.entries()) {
    await prisma.opsDriver.update({ where: { id: c.id }, data: { cin: c.cin ?? `BK${100000 + i * 731}`, hireDate: c.hireDate ?? new Date(Date.now() - (200 + i * 9) * DAY), licenseNo: c.licenseNo ?? `PC-${40000 + i * 37}`, contractType: 'CDI', dailyRate: c.dailyRate }})
    const code = 'H' + String(i + 1).padStart(2, '0')
    if (await prisma.opsDriver.findUnique({ where: { code } })) continue
    await prisma.opsDriver.create({ data: {
      code, firstName: HFIRST[i % HFIRST.length], lastName: HLAST[i % HLAST.length], phone: '0610' + String(200000 + i * 211).slice(0, 6),
      hubId: c.hubId, homeHubId: c.homeHubId, vehicleId: c.vehicleId, jobType: 'helper', dailyRate: 100, payMode: 'fixed',
      cin: `BE${200000 + i * 457}`, hireDate: new Date(Date.now() - (120 + i * 7) * DAY), contractType: 'CDD', onboardingStatus: 'actif', trainingDone: true, quizScore: 80 + (i % 4) * 5,
    } })
    made++
  }
  // véhicules : détails de démonstration
  const vehicles = await prisma.opsVehicle.findMany({ orderBy: { plate: 'asc' } })
  const BRANDS = { moto: [['Honda', 'PCX'], ['Yamaha', 'NMAX']], utilitaire: [['Renault', 'Kangoo'], ['Peugeot', 'Partner']], van: [['Renault', 'Master'], ['Ford', 'Transit']] }
  for (const [i, v] of vehicles.entries()) {
    const [brand, model] = (BRANDS[v.type] || BRANDS.utilitaire)[i % 2]
    await prisma.opsVehicle.update({ where: { id: v.id }, data: { brand: v.brand ?? brand, model: v.model ?? model, year: v.year ?? 2019 + (i % 6), registrationNo: v.registrationNo ?? `CG-${700000 + i * 113}`, insuranceExpiry: v.insuranceExpiry ?? new Date(Date.now() + (20 + i * 14) * DAY), technicalVisitExpiry: v.technicalVisitExpiry ?? new Date(Date.now() + (40 + i * 11) * DAY) } })
  }
  console.log(`[seed-crew] ${made} helper(s) créé(s) · ${chauffeurs.length} chauffeurs · ${vehicles.length} véhicules mis à jour`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
