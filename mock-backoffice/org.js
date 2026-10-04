'use strict'
// Organisation de test partagée : utilisée par le mock back-office ET par scripts/seed-ops.js.
// 3 villes · 7 hubs · 23 livreurs · 23 véhicules.
// Les hubs CAS-MM / CAS-DB / MRK-MS existent dans data3.xlsx (Marjane Morocco Mall, Dar Bouazza, Massira=Marrakech).
// Les 4 autres sont fictifs, placés au centre de la demande (k-means sur data3) (coordonnées approximatives).

const HUBS = [
  { code: 'CAS-MM', name: 'Marjane Morocco Mall', city: 'CASABLANCA', lat: 33.574117, lng: -7.708288, drivers: 5 },
  { code: 'CAS-DB', name: 'Marjane Dar Bouazza',  city: 'CASABLANCA', lat: 33.538384, lng: -7.767626, drivers: 3 },
  { code: 'CAS-TM', name: 'Marjane Tamaris',      city: 'CASABLANCA', lat: 33.5140,   lng: -7.8300,   drivers: 3 },
  { code: 'CAS-CA', name: 'Marjane Californie',   city: 'CASABLANCA', lat: 33.5650,   lng: -7.6600,   drivers: 3 },
  { code: 'MRK-MS', name: 'Marjane Massira',      city: 'MARRAKECH',  lat: 31.628511, lng: -8.079131, drivers: 4 },
  { code: 'MRK-ME', name: 'Marjane Menara',       city: 'MARRAKECH',  lat: 31.5900,   lng: -8.0300,   drivers: 2 },
  { code: 'AGA-01', name: 'Marjane Agadir',       city: 'AGADIR',     lat: 30.4208,   lng: -9.5483,   drivers: 3 },
]

const FIRST = ['Youssef', 'Mehdi', 'Hamza', 'Anas', 'Omar', 'Karim', 'Reda', 'Ayoub', 'Soufiane', 'Zakaria', 'Imane', 'Salma',
  'Hicham', 'Nabil', 'Amine', 'Walid', 'Bilal', 'Yassine', 'Rachid', 'Khalid', 'Tarik', 'Said', 'Driss']
const LAST = ['Benali', 'El Idrissi', 'Alaoui', 'Tazi', 'Bennani', 'Chraibi', 'Lahlou', 'Fassi', 'Berrada', 'Amrani', 'Mansouri',
  'Haddad', 'Ouazzani', 'Skalli', 'Naciri', 'Zniber', 'Kettani', 'Sebti', 'Guerraoui', 'Belhaj', 'Rifi', 'Slaoui', 'Daoudi']
const VEHICLE_TYPES = ['moto', 'moto', 'utilitaire', 'utilitaire', 'van']
const FUEL = { moto: 'essence', utilitaire: 'diesel', van: 'diesel' }

function buildDrivers() {
  const out = []
  let n = 0
  for (const h of HUBS) {
    for (let i = 0; i < h.drivers; i++) {
      const idx = n++
      const code = 'D' + String(idx + 1).padStart(2, '0')
      const vType = VEHICLE_TYPES[idx % VEHICLE_TYPES.length]
      out.push({
        code,
        firstName: FIRST[idx],
        lastName: LAST[idx],
        phone: '0600' + String(100000 + idx * 137).slice(0, 6),
        hubCode: h.code,
        city: h.city,
        vehicle: {
          plate: `${10000 + idx * 211}-A-${h.city === 'CASABLANCA' ? 6 : h.city === 'MARRAKECH' ? 40 : 1}`,
          type: vType,
          fuelType: FUEL[vType],
          capacityKg: vType === 'moto' ? 25 : vType === 'utilitaire' ? 600 : 1200,
          consumptionL100: vType === 'moto' ? 3.2 : vType === 'utilitaire' ? 8.5 : 11,
        },
      })
    }
  }
  return out
}

module.exports = { HUBS, buildDrivers }
