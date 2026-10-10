// Tests purs du moteur de tournée, de l'ETA par stop, des secteurs et des vagues — Agent C. Aucun accès base.
// node scripts/test-route-engine.mjs
import assert from 'node:assert/strict'

const { lib } = await import('./_ts-alias.mjs')
const route = await lib('ops-route.ts')
const eta = await lib('ops-eta.ts')
const sectors = await lib('ops-sectors.ts')
const waves = await lib('ops-waves.ts')
let n = 0
const t = (name, fn) => { fn(); n++; console.log('  ok -', name) }

const hub = { lat: 33.5731, lng: -7.5898 }
// points alignés vers l'est : l'ordre optimal depuis le hub est croissant en longitude
const line = [0.05, 0.01, 0.03, 0.02, 0.04].map((d, i) => ({ id: 'o' + i, lat: 33.5731, lng: -7.5898 + d, slot: '12-15', slotStart: Date.UTC(2026, 9, 10, 11), slotEnd: Date.UTC(2026, 9, 10, 14) }))

// ── Géométrie ──
t('NN depuis le hub visite les points alignés dans l\'ordre', () => {
  const pts = line.map(o => ({ lat: o.lat, lng: o.lng }))
  const order = route.nearestNeighbour(hub, pts).map(i => line[i].id)
  assert.deepEqual(order, ['o1', 'o3', 'o2', 'o4', 'o0'])
})
t('2-opt ne dégrade jamais et corrige un mauvais ordre', () => {
  const pts = line.map(o => ({ lat: o.lat, lng: o.lng }))
  const bad = [4, 0, 2, 1, 3]
  const better = route.twoOpt(hub, pts, bad)
  assert.ok(route.pathLengthM(hub, pts, better) <= route.pathLengthM(hub, pts, bad))
  const optimal = route.pathLengthM(hub, pts, [1, 3, 2, 4, 0])
  assert.ok(route.pathLengthM(hub, pts, better) <= optimal * 1.0001 + 1, 'doit trouver l\'optimum sur 5 points alignés')
})
t('2-opt : même résultat quel que soit le point de départ de l\'ordre (jamais pire que NN)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let k = 0; k < 30; k++) {
    const pts = Array.from({ length: 9 }, () => ({ lat: 33.5 + rnd() * 0.1, lng: -7.6 + rnd() * 0.1 }))
    const nn = route.nearestNeighbour(hub, pts)
    assert.ok(route.pathLengthM(hub, pts, route.twoOpt(hub, pts, nn)) <= route.pathLengthM(hub, pts, nn))
  }
})
t('cheapestInsertion place un point intermédiaire entre ses voisins', () => {
  const path = [{ lat: 33.5731, lng: -7.58 }, { lat: 33.5731, lng: -7.54 }]
  assert.equal(route.cheapestInsertion(hub, path, { lat: 33.5731, lng: -7.56 }), 1)
  assert.equal(route.cheapestInsertion(hub, path, { lat: 33.5731, lng: -7.50 }), 2)
})

// ── ETA ──
t('vitesse par heure : plus lent à l\'heure de pointe, coefficient appliqué', () => {
  const noon = Date.UTC(2026, 9, 10, 3) // 04:00 locale (UTC+1) → fluide
  const rush = Date.UTC(2026, 9, 10, 17) // 18:00 locale → dense
  assert.ok(eta.speedKmhAt(rush) < eta.speedKmhAt(noon))
  const slow = { ...eta.DEFAULT_TRAFFIC, trafficCoef: 2 }
  assert.ok(Math.abs(eta.speedKmhAt(rush, slow) - eta.speedKmhAt(rush) / 2) < 1e-9 || eta.speedKmhAt(rush, slow) === 5)
})
t('legMinutes : proportionnel à la distance, plancher minLegMin, défaut si position inconnue', () => {
  const a = { lat: 33.57, lng: -7.59 }, b = { lat: 33.58, lng: -7.59 }
  const at = Date.UTC(2026, 9, 10, 10)
  assert.ok(eta.legMinutes(a, { lat: 33.60, lng: -7.59 }, at) > eta.legMinutes(a, b, at))
  assert.equal(eta.legMinutes(a, a, at), eta.DEFAULT_TRAFFIC.minLegMin)
  assert.equal(eta.legMinutes(null, b, at), eta.DEFAULT_TRAFFIC.defaultLegMin)
})
t('computeArrivals : croissant, inclut le temps de service', () => {
  const travel = () => 10
  const arr = route.computeArrivals(hub, 0, [{ pt: hub, serviceMin: 8 }, { pt: hub, serviceMin: 8 }, { pt: hub, serviceMin: 8 }], travel)
  assert.deepEqual(arr.map(x => x / 60000), [10, 28, 46])
})
t('les fonctions historiques de l\'ETA v1 sont intactes', () => {
  assert.equal(typeof eta.predictEtaFrom, 'function'); assert.equal(typeof eta.computeEtaAccuracy, 'function')
  const r = eta.predictEtaFrom({ status: 'DELIVERED', hubCode: 'X', slot: '09-12', stageAt: null, slotEnd: 0 }, [], Date.now())
  assert.equal(r.etaAt, null)
})
t('libellé « sans trafic live » exposé', () => assert.match(eta.ETA_LABEL_NO_LIVE, /sans trafic live/i))

// ── Planification ──
const travel = eta.makeTravel(eta.DEFAULT_TRAFFIC)
const P = { serviceMin: 8, maxStops: 3, rotationsPerSlot: 2, loadMin: 15 }
t('planDriverDay : 7 commandes, capacité 3 → 3 rotations équilibrées (3,2,2), toutes les commandes une seule fois', () => {
  const orders = Array.from({ length: 7 }, (_, i) => ({ id: 'x' + i, lat: 33.57 + i * 0.004, lng: -7.59, slot: '12-15', slotStart: Date.UTC(2026, 9, 10, 11), slotEnd: Date.UTC(2026, 9, 10, 14) }))
  const plan = route.planDriverDay(orders, hub, travel, P)
  assert.deepEqual(plan.map(p => p.orderIds.length), [3, 2, 2])
  assert.equal(new Set(plan.flatMap(p => p.orderIds)).size, 7)
  assert.ok(plan.every(p => p.orderIds.length <= P.maxStops))
  assert.equal(plan[2].overflow, true); assert.equal(plan[1].overflow, false) // 2 rotations par créneau autorisées
})
t('planDriverDay : la rotation suivante part après le retour de la précédente', () => {
  const orders = Array.from({ length: 6 }, (_, i) => ({ id: 'y' + i, lat: 33.57 + i * 0.004, lng: -7.59, slot: '12-15', slotStart: Date.UTC(2026, 9, 10, 11), slotEnd: Date.UTC(2026, 9, 10, 14) }))
  const plan = route.planDriverDay(orders, hub, travel, P)
  assert.ok(plan[1].departAt >= plan[0].returnAt)
  for (const p of plan) for (let i = 1; i < p.arrivals.length; i++) assert.ok(p.arrivals[i] > p.arrivals[i - 1])
})
t('planDriverDay : départ jamais avant le début du créneau - chargement', () => {
  const slotStart = Date.UTC(2026, 9, 10, 11)
  const plan = route.planDriverDay(line.map(o => ({ ...o, slotStart })), hub, travel, P)
  assert.ok(plan[0].departAt >= slotStart - P.loadMin * 60000)
})
t('planDriverDay : créneaux successifs triés par heure, sans mélange de créneaux dans une rotation', () => {
  const a = { id: 'a', lat: 33.58, lng: -7.59, slot: '15-18', slotStart: Date.UTC(2026, 9, 10, 14), slotEnd: Date.UTC(2026, 9, 10, 17) }
  const b = { id: 'b', lat: 33.581, lng: -7.59, slot: '09-12', slotStart: Date.UTC(2026, 9, 10, 8), slotEnd: Date.UTC(2026, 9, 10, 11) }
  const plan = route.planDriverDay([a, b], hub, travel, P)
  assert.deepEqual(plan.map(p => p.slot), ['09-12', '15-18'])
  assert.ok(plan.every(p => p.orderIds.length === 1))
})
t('planDriverDay : commande sans GPS acceptée (en fin de rotation), pas de plantage', () => {
  const o = [{ id: 'g1', lat: 33.58, lng: -7.59, slot: 'S', slotStart: 0, slotEnd: 1e12 }, { id: 'nogps', lat: null, lng: null, slot: 'S', slotStart: 0, slotEnd: 1e12 }]
  const plan = route.planDriverDay(o, hub, travel, P)
  assert.deepEqual(plan[0].orderIds, ['g1', 'nogps'])
})
t('planDriverDay : les secteurs ne sont pas entremêlés quand c\'est possible', () => {
  const mk = (id, lat, sector) => ({ id, lat, lng: -7.59, slot: 'S', slotStart: 0, slotEnd: 1e12, sector })
  const orders = [mk('n1', 33.60, 'NORD'), mk('s1', 33.54, 'SUD'), mk('n2', 33.601, 'NORD'), mk('s2', 33.541, 'SUD')]
  const plan = route.planDriverDay(orders, hub, travel, { ...P, maxStops: 2 })
  for (const p of plan) assert.equal(new Set(p.orderIds.map(id => id[0])).size, 1)
})
t('réglages : bornes respectées, valeurs hors bornes ignorées', () => {
  const ok = route.sanitizeRouteSettings({ serviceMin: 10, maxStops: 0, roadFactor: 9, trafficCurve: new Array(24).fill(1), baseSpeedKmh: 'x' })
  assert.deepEqual(Object.keys(ok).sort(), ['serviceMin', 'trafficCurve'])
  assert.equal(route.sanitizeRouteSettings({ trafficCurve: [1, 1] }).trafficCurve, undefined)
})

// ── Secteurs ──
const sq = [[33.5, -7.7], [33.5, -7.5], [33.7, -7.5], [33.7, -7.7]]
t('parsePolygon : JSON, texte lat,lng, rejets', () => {
  assert.equal(sectors.parsePolygon(JSON.stringify(sq)).length, 4)
  assert.equal(sectors.parsePolygon('33.5,-7.7\n33.5,-7.5\n33.7,-7.5').length, 3)
  assert.equal(sectors.parsePolygon([[1, 2], [3, 4]]), null)
  assert.equal(sectors.parsePolygon([[95, 2], [3, 4], [5, 6]]), null)
  assert.equal(sectors.parsePolygon('pas du json'), null)
})
t('pointInPolygon : dedans / dehors', () => {
  assert.equal(sectors.pointInPolygon(33.6, -7.6, sq), true)
  assert.equal(sectors.pointInPolygon(33.8, -7.6, sq), false)
  assert.equal(sectors.pointInPolygon(33.6, -7.4, sq), false)
})
t('sectorFor : polygone d\'abord (le plus petit), repli quartier sans GPS, filtre par hub', () => {
  const big = { code: 'BIG', name: 'Grand', hubCode: null, polygon: sq, active: true }
  const small = { code: 'SMALL', name: 'Petit', hubCode: null, polygon: [[33.59, -7.61], [33.59, -7.59], [33.61, -7.59], [33.61, -7.61]], active: true }
  const maarif = { code: 'MAA', name: 'Maârif / Gauthier', hubCode: 'CAS-MM', polygon: [], active: true }
  const all = [big, small, maarif]
  assert.deepEqual(sectors.sectorFor({ lat: 33.6, lng: -7.6 }, all), { code: 'SMALL', via: 'polygon' })
  assert.deepEqual(sectors.sectorFor({ lat: 33.52, lng: -7.52 }, all), { code: 'BIG', via: 'polygon' })
  assert.deepEqual(sectors.sectorFor({ district: 'MAARIF', hubCode: 'CAS-MM' }, all), { code: 'MAA', via: 'district' })
  assert.deepEqual(sectors.sectorFor({ district: 'gauthier' }, all), { code: 'MAA', via: 'district' })
  assert.equal(sectors.sectorFor({ district: 'Maarif', hubCode: 'AUTRE' }, all), null)
  assert.equal(sectors.sectorFor({ lat: 40, lng: 0 }, all), null)
  assert.equal(sectors.sectorFor({ lat: 33.6, lng: -7.6 }, [{ ...big, active: false }]), null)
})
t('validateSectorInput : code et polygone contrôlés', () => {
  assert.equal(sectors.validateSectorInput({ code: 'a b', name: 'x', polygon: sq }).ok, false)
  assert.equal(sectors.validateSectorInput({ code: 'n1', name: 'Nord', polygon: [[1, 1]] }).ok, false)
  const v = sectors.validateSectorInput({ code: 'n1', name: 'Nord', polygon: sq })
  assert.ok(v.ok && v.value.code === 'N1')
})

// ── Vagues ──
t('lotSizes : 3 à 4 par lot, équilibré', () => {
  assert.deepEqual(waves.lotSizes(0, 3, 4), [])
  assert.deepEqual(waves.lotSizes(1, 3, 4), [1])
  assert.deepEqual(waves.lotSizes(4, 3, 4), [4])
  assert.deepEqual(waves.lotSizes(5, 3, 4), [3, 2])
  assert.deepEqual(waves.lotSizes(7, 3, 4), [3, 2, 2].sort((a, b) => b - a))
  for (let n = 1; n <= 60; n++) { const s = waves.lotSizes(n, 3, 4); assert.equal(s.reduce((a, b) => a + b, 0), n); assert.ok(s.every(x => x <= 4)) }
})
t('buildLots : lots géographiques par secteur, fusion des petits secteurs, aucun doublon', () => {
  const mk = (id, lat, lng, sector, end = 1000) => ({ id, ref: id, lat, lng, sector, district: null, hubCode: 'H', slot: '12-15', slotStart: 0, slotEnd: end, status: 'READY_PICKUP' })
  const orders = [
    ...Array.from({ length: 6 }, (_, i) => mk('n' + i, 33.62 + i * 0.001, -7.59, 'NORD')),
    ...Array.from({ length: 4 }, (_, i) => mk('s' + i, 33.52 + i * 0.001, -7.59, 'SUD')),
    mk('lone', 33.521, -7.59, 'EST'), // secteur d'une seule commande → fusionné avec SUD (le plus proche)
  ]
  const lots = waves.buildLots(orders, '2026-10-10', '12-15', 'H', { target: 3, max: 4, hubPts: { H: { lat: 33.57, lng: -7.59 } } })
  const ids = lots.flatMap(l => l.orders.map(o => o.id))
  assert.equal(new Set(ids).size, orders.length)
  assert.ok(lots.every(l => l.orders.length >= 1 && l.orders.length <= 4))
  const loneLot = lots.find(l => l.orders.some(o => o.id === 'lone'))
  assert.ok(loneLot.orders.every(o => o.id === 'lone' || o.id.startsWith('s')), 'lone doit être avec SUD')
  assert.ok(lots.every(l => !(l.orders.some(o => o.id.startsWith('n')) && l.orders.some(o => o.id.startsWith('s')))), 'jamais de lot NORD+SUD')
  assert.deepEqual(lots.map(l => l.n), lots.map((_, i) => i + 1))
  assert.match(lots[0].waveId, /^W20261010-12-15-H-L01$/)
})
t('buildLots : lots numérotés par urgence (fin de créneau la plus proche d\'abord)', () => {
  const mk = (id, lat, sector, end) => ({ id, ref: id, lat, lng: -7.59, sector, district: null, hubCode: 'H', slot: 'S', slotStart: 0, slotEnd: end, status: 'READY_PICKUP' })
  const orders = [mk('a1', 33.6, 'A', 5000), mk('a2', 33.601, 'A', 5000), mk('b1', 33.5, 'B', 1000), mk('b2', 33.501, 'B', 1000)]
  const lots = waves.buildLots(orders, '2026-10-10', 'S', null, { target: 3, max: 4 })
  assert.equal(lots[0].sector, 'B')
  assert.equal(waves.parseWaveId(lots[0].waveId).lot, 1)
})

console.log(`\n${n} tests OK`)
