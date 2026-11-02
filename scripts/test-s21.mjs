// Tests Sprint 21 (pilotage intelligent) — node scripts/test-s21.mjs
import assert from 'node:assert/strict'
import { lib } from './_ts-alias.mjs'

const ex = await lib('ops-express.ts')
const re = await lib('ops-reassign.ts')
const pr = await lib('ops-predictive.ts')
const gm = await lib('ops-gamification.ts')
const pl = await lib('ops-planning-auto.ts')

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name) }
const MIN = 60_000, NOW = Date.parse('2026-11-02T10:00:00Z')

ok('express : SLA 45 par défaut, 80 pour une grosse commande', () => {
  assert.equal(ex.expressSla(3), 45); assert.equal(ex.expressSla(null), 45); assert.equal(ex.expressSla(15), 80)
})
ok('express : SLA selon le type de magasin (hypermarché 80, supermarché 45)', () => {
  assert.equal(ex.expressSlaForOrder({ storeType: 'hypermarket' }), 80)
  assert.equal(ex.expressSlaForOrder({ storeType: 'supermarket', items: 40 }), 45)
  assert.equal(ex.expressSlaForOrder({ items: 20 }), 80)
})
ok('express : paliers 45/50/55 et 80/85/90', () => {
  assert.deepEqual([44, 45, 50, 55].map(m => ex.expressLevel(m, 45)), [0, 1, 2, 3])
  assert.deepEqual([79, 80, 85, 90].map(m => ex.expressLevel(m, 80)), [0, 1, 2, 3])
})
ok('express : chrono sans pause, annulée = hors SLA', () => {
  assert.equal(ex.expressElapsed({ startedAt: NOW - 50 * MIN, pausedMinutes: 10 }, NOW), 40)
  assert.equal(ex.expressElapsed({ startedAt: NOW - 50 * MIN, endedAt: NOW - 20 * MIN }, NOW), 30)
  assert.equal(ex.expressElapsed({ startedAt: NOW - 50 * MIN, cancelled: true }, NOW), null)
  assert.equal(ex.expressRespected(null, 45), false)
})

const drv = (id, load, available = true) => ({ id, code: id, load, points: [], available })
ok('réaffectation : livreur indisponible → commandes à un livreur disponible, jamais à lui-même', () => {
  const orders = [
    { id: 'o1', slotStart: NOW, slotEnd: NOW + 60 * MIN, lat: null, lng: null, status: 'ASSIGNED', driverId: 'A' },
    { id: 'o2', slotStart: NOW, slotEnd: NOW + 60 * MIN, lat: null, lng: null, status: 'ASSIGNED', driverId: 'B' },
    { id: 'o3', slotStart: NOW, slotEnd: NOW + 60 * MIN, lat: null, lng: null, status: 'START_DELIVERY', driverId: 'A' }, // déjà en livraison : intouchable
  ]
  const r = re.proposeReassignments(orders, [drv('A', 1, false), drv('B', 1), drv('C', 0)], NOW)
  assert.deepEqual(r.map(x => [x.orderId, x.from, x.reason]), [['o1', 'A', 'driver_unavailable']])
  assert.notEqual(r[0].to, 'A')
})
ok('réaffectation : retard > seuil seulement', () => {
  const o = (id, endOffset) => ({ id, slotStart: NOW - 3_600_000, slotEnd: NOW + endOffset * MIN, lat: null, lng: null, status: 'ASSIGNED', driverId: 'A' })
  const r = re.proposeReassignments([o('late', -30), o('ok', -5)], [drv('A', 2), drv('B', 0)], NOW, 20)
  assert.deepEqual(r.map(x => x.orderId), ['late']); assert.equal(r[0].to, 'B'); assert.equal(r[0].reason, 'late')
})
ok('réaffectation : aucun livreur disponible → rien', () => {
  assert.deepEqual(re.proposeReassignments([{ id: 'o', slotStart: 0, slotEnd: NOW - 60 * MIN, lat: null, lng: null, status: 'ASSIGNED', driverId: 'A' }], [drv('A', 1, false)], NOW), [])
})

ok('prédictif : vitesse réelle et dépassement annoncé avant le retard', () => {
  assert.equal(pr.driverPace([NOW - 90 * MIN, NOW - 60 * MIN, NOW - 30 * MIN]), 30)
  assert.equal(pr.driverPace([NOW]), 25)
  const orders = [
    { id: 'd1', driverId: 'A', slotEnd: 0, open: false, deliveredAt: NOW - 90 * MIN },
    { id: 'd2', driverId: 'A', slotEnd: 0, open: false, deliveredAt: NOW - 60 * MIN },
    { id: 'd3', driverId: 'A', slotEnd: 0, open: false, deliveredAt: NOW - 30 * MIN },
    { id: 'x1', driverId: 'A', slotEnd: NOW + 40 * MIN, open: true },  // arrivée prévue +30 : OK
    { id: 'x2', driverId: 'A', slotEnd: NOW + 45 * MIN, open: true },  // arrivée prévue +60 : dépasse de 15
  ]
  const p = pr.predictOverruns(orders, NOW)
  assert.deepEqual(p.map(x => [x.orderId, x.overrunMin]), [['x2', 15]])
})

ok('gamification : classement par hub, séries et badges', () => {
  const d = (driverId, hub, day, delivered, onTime) => ({ driverId, hub, day, delivered, onTime })
  const res = [
    d('A', 'CASA', '2026-10-30', 10, 10), d('A', 'CASA', '2026-10-31', 10, 10), d('A', 'CASA', '2026-11-01', 10, 10),
    d('B', 'CASA', '2026-10-30', 10, 8), d('B', 'CASA', '2026-11-01', 10, 10),
    d('C', 'RABAT', '2026-11-01', 2, 2), // sous le seuil
    d('E', 'RABAT', '2026-11-01', 6, 6),
  ]
  const lb = gm.leaderboard(res)
  assert.deepEqual(lb.CASA.map(r => [r.driverId, r.rank]), [['A', 1], ['B', 2]])
  assert.equal(lb.CASA[0].streak, 3); assert.ok(lb.CASA[0].badges.includes('série-3')); assert.ok(lb.CASA[0].badges.includes('sans-faute'))
  assert.equal(lb.CASA[1].streak, 1)
  assert.deepEqual(lb.RABAT.map(r => r.driverId), ['E'])
})

ok('planning auto : hubs d\'origine d\'abord, emprunt ensuite, manque signalé', () => {
  const drivers = [
    { code: 'D1', homeHub: 'CASA', available: true }, { code: 'D2', homeHub: 'CASA', available: true },
    { code: 'D3', homeHub: 'RABAT', available: true }, { code: 'D4', homeHub: 'RABAT', available: false },
  ]
  const p = pl.proposePlanning([{ hub: 'CASA', forecast: 70 }, { hub: 'RABAT', forecast: 20 }], drivers, 25)
  // CASA : 3 équipes (2 locales + 1 empruntée) ; RABAT : 1 équipe (D3) → après CASA il ne reste personne à emprunter
  assert.equal(p.teams.filter(t => t.hub === 'CASA').length, 2)
  assert.deepEqual(p.shortfall, { CASA: 1 })
  assert.ok(p.teams.find(t => t.driver === 'D3' && t.hub === 'RABAT' && !t.borrowed))
})

console.log(`\n${n} tests OK`)
