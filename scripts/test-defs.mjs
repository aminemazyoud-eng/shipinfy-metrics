// Test des définitions uniques (Sprint 17 B7) — node scripts/test-defs.mjs
// Jeu FIXE de 12 commandes ; mêmes totaux attendus dans lib/ops-defs (source), liveSnapshot (Cockpit) et buildHistory (Historique).
import assert from 'node:assert/strict'
import { lib } from './_ts-alias.mjs'

const defs = await lib('ops-defs.ts')
const analytics = await lib('ops-analytics.ts')
const history = await lib('ops-history.ts')

const NOW = Date.parse('2026-10-06T14:00:00Z') // 15:00 locale (UTC+1 hors Ramadan) ; atRiskMinutes = 45
const iso = (hhmm) => `2026-10-06T${hhmm}:00Z`

// [n°, statut, fin de créneau (Z), livreur, livrée à (Z)]
const RAW = [
  [1, 'DELIVERED', '12:00', 'D1', '11:30'],   // à l'heure
  [2, 'DELIVERED', '12:00', 'D1', '12:10'],   // livrée en retard
  [3, 'DELIVERED', '13:00', 'D2', '12:59'],   // à l'heure
  [4, 'NO_SHOW', '11:00', 'D2', null],
  [5, 'CANCELLED', '10:00', null, null],      // créneau dépassé mais ANNULÉE : jamais en retard
  [6, 'CANCELLED', '16:00', null, null],
  [7, 'READY_PICKUP', '13:00', null, null],   // non assignée ET en retard
  [8, 'READY_PICKUP', '14:20', null, null],   // non assignée, à risque (20 min)
  [9, 'ASSIGNED', '13:30', 'D1', null],       // en retard
  [10, 'IN_TRANSPORT', '14:30', 'D2', null],  // à risque (30 min)
  [11, 'START_DELIVERY', '14:10', 'D1', null],// déjà en livraison : jamais « à risque »
  [12, 'ASSIGNED', '20:00', 'D2', null],      // ni l'un ni l'autre
]
const state = RAW.map(([n, status, end, driverId, del]) => ({ n, status, slotEnd: iso(end), driverId, deliveredAt: del ? iso(del) : null }))
const count = (fn) => state.filter(fn).length
const ids = (fn) => state.filter(fn).map(o => o.n)

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name) }

ok('ops-defs : retard = ouverte ET créneau dépassé (non assignées incluses, CANCELLED exclu)', () => {
  assert.deepEqual(ids(o => defs.isLate(o, NOW)), [7, 9])
})
ok('ops-defs : à risque = ouverte, pas en livraison, fin < 45 min', () => {
  assert.deepEqual(ids(o => defs.isAtRisk(o, NOW)), [8, 10])
})
ok('ops-defs : non assignée = READY_PICKUP sans livreur', () => {
  assert.deepEqual(ids(o => defs.isUnassigned(o)), [7, 8])
})
ok('ops-defs : à l’heure = livrée au plus tard à la fin du créneau', () => {
  assert.deepEqual(ids(o => defs.isOnTime(o)), [1, 3])
  assert.deepEqual(ids(o => defs.isDeliveredLate(o)), [2])
})
ok('ops-defs : ouvertes / terminales (CANCELLED terminal)', () => {
  assert.equal(count(o => defs.isOpen(o)), 6)
  assert.equal(count(o => defs.isTerminal(o.status)), 6)
  assert.equal(defs.lateMinutes(state[6], NOW), 60)
  assert.equal(defs.lateMinutes(state[4], NOW), 0) // annulée
})

// ─── Cockpit : liveSnapshot ─────────────────────────────────────────────────────────────
const toLite = (o) => {
  const end = Date.parse(o.slotEnd)
  return {
    id: 'o' + o.n, hubCode: 'H1', city: 'CASABLANCA', status: o.status, slotStart: new Date(end - 3 * 3_600_000).toISOString(), slotEnd: o.slotEnd,
    slotLabel: null, createdAt: iso('06:00'), deliveredAt: o.deliveredAt, noShowAt: o.status === 'NO_SHOW' ? iso('10:30') : null,
    lat: null, lng: null, driverCode: o.driverId, amount: null, district: null,
  }
}
const lites = state.map(toLite)
const hubs = [{ code: 'H1', name: 'Hub 1', city: 'CASABLANCA', lat: null, lng: null }]
const drivers = [{ code: 'D1', firstName: 'A', lastName: 'A', hubCode: 'H1' }, { code: 'D2', firstName: 'B', lastName: 'B', hubCode: 'H1' }]

ok('Cockpit (liveSnapshot) : mêmes totaux, CANCELLED hors des totaux actifs mais compté à part', () => {
  const t = analytics.liveSnapshot(lites, hubs, drivers, NOW).totals
  assert.equal(t.total, 10)       // 12 - 2 annulées
  assert.equal(t.done, 4)         // 3 livrées + 1 NO_SHOW
  assert.equal(t.late, 2)
  assert.equal(t.atRisk, 2)
  assert.equal(t.unassigned, 2)
  assert.equal(t.cancelled, 2)
})
ok('analytics.isLate / isAtRisk = ops-defs (ré-export)', () => {
  assert.equal(analytics.isLate, defs.isLate)
  assert.equal(analytics.isAtRisk, defs.isAtRisk)
})

// ─── Historique : buildHistory ──────────────────────────────────────────────────────────
ok('Historique (buildHistory) : cancelled / cancelRate, annulées hors volume traité', () => {
  const rows = lites.map(l => ({ slotStart: new Date(l.slotStart), slotEnd: new Date(l.slotEnd), status: l.status, hubCode: l.hubCode, driverCode: l.driverCode, createdAt: new Date(l.createdAt), deliveredAt: l.deliveredAt ? new Date(l.deliveredAt) : null, noShowAt: l.noShowAt ? new Date(l.noShowAt) : null, amount: null }))
  const h = history.buildHistory(rows)
  assert.equal(h.totals.cancelled, 2)
  assert.equal(h.totals.total, 10)
  assert.equal(h.totals.cancelRate, 16.7) // 2 / 12
  assert.equal(h.totals.delivered, 3)
  assert.equal(h.totals.noShow, 1)
  assert.equal(h.totals.onTimeRate, 66.7) // 2 livrées à l'heure sur 3
})

console.log(`\ntest-defs : ${n} groupes de tests OK`)
