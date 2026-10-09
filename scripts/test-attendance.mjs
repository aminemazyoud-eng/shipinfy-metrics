// Tests purs du pointage (Sprint 18) — node scripts/test-attendance.mjs
// workedMinutes, lateMinutes (heure locale réelle, Ramadan inclus), autoStatus. Aucun accès base.
import assert from 'node:assert/strict'
import { lib } from './_ts-alias.mjs'

const c = await lib('ops-attendance-calc.ts')
let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name) }
const D = (iso) => new Date(iso)

// ─── workedMinutes ───
ok('workedMinutes : 8 h', () => assert.equal(c.workedMinutes(D('2026-10-06T07:30:00Z'), D('2026-10-06T15:30:00Z')), 480))
ok('workedMinutes : chaînes ISO acceptées', () => assert.equal(c.workedMinutes('2026-10-06T07:30:00Z', '2026-10-06T08:00:00Z'), 30))
ok('workedMinutes : 0 si arrivée ou départ absent', () => { assert.equal(c.workedMinutes(null, D('2026-10-06T15:30:00Z')), 0); assert.equal(c.workedMinutes(D('2026-10-06T07:30:00Z'), null), 0) })
ok('workedMinutes : 0 si départ avant arrivée', () => assert.equal(c.workedMinutes(D('2026-10-06T10:00:00Z'), D('2026-10-06T09:00:00Z')), 0))
ok('workedMinutes : plafonné à 16 h', () => assert.equal(c.workedMinutes(D('2026-10-06T00:00:00Z'), D('2026-10-07T12:00:00Z')), 960))

// ─── lateMinutes (hors Ramadan : 08:30 locale = 07:30Z) ───
ok('lateMinutes : à l\'heure => 0', () => assert.equal(c.lateMinutes(D('2026-10-06T07:30:00Z'), '08:30', '2026-10-06'), 0))
ok('lateMinutes : en avance => 0', () => assert.equal(c.lateMinutes(D('2026-10-06T07:00:00Z'), '08:30', '2026-10-06'), 0))
ok('lateMinutes : 25 min de retard hors Ramadan', () => assert.equal(c.lateMinutes(D('2026-10-06T07:55:00Z'), '08:30', '2026-10-06'), 25))
ok('lateMinutes : pas de départ prévu => 0', () => { assert.equal(c.lateMinutes(D('2026-10-06T09:00:00Z'), null, '2026-10-06'), 0); assert.equal(c.lateMinutes(D('2026-10-06T09:00:00Z'), 'xx', '2026-10-06'), 0) })
ok('lateMinutes : pas d\'arrivée => 0', () => assert.equal(c.lateMinutes(null, '08:30', '2026-10-06'), 0))
// Ramadan 2027-02-20 : heure locale = UTC+0, donc 08:30 locale = 08:30Z
ok('lateMinutes Ramadan : 08:50Z vs 08:30 => 20 min', () => assert.equal(c.lateMinutes(D('2027-02-20T08:50:00Z'), '08:30', '2027-02-20'), 20))
ok('lateMinutes Ramadan : 07:50Z est EN AVANCE (pas +1 h fixe) => 0', () => assert.equal(c.lateMinutes(D('2027-02-20T07:50:00Z'), '08:30', '2027-02-20'), 0))
ok('lateMinutes Ramadan : 08:30Z pile => 0', () => assert.equal(c.lateMinutes(D('2027-02-20T08:30:00Z'), '08:30', '2027-02-20'), 0))

// ─── autoStatus ───
ok('LATE_GRACE_MIN = 10', () => assert.equal(c.LATE_GRACE_MIN, 10))
ok('autoStatus : retard > tolérance => late', () => assert.equal(c.autoStatus({ current: 'present', hasCheckIn: true, hasPlan: true, lateMinutes: 11 }), 'late'))
ok('autoStatus : retard = tolérance => present', () => assert.equal(c.autoStatus({ current: 'present', hasCheckIn: true, hasPlan: true, lateMinutes: 10 }), 'present'))
ok('autoStatus : à l\'heure corrige un late erroné', () => assert.equal(c.autoStatus({ current: 'late', hasCheckIn: true, hasPlan: true, lateMinutes: 0 }), 'present'))
ok('autoStatus : ne JAMAIS écraser absent', () => assert.equal(c.autoStatus({ current: 'absent', hasCheckIn: true, hasPlan: true, lateMinutes: 60 }), 'absent'))
ok('autoStatus : ne JAMAIS écraser leave', () => assert.equal(c.autoStatus({ current: 'leave', hasCheckIn: true, hasPlan: true, lateMinutes: 0 }), 'leave'))
ok('autoStatus : sans planning, statut conservé', () => { assert.equal(c.autoStatus({ current: 'late', hasCheckIn: true, hasPlan: false, lateMinutes: 0 }), 'late'); assert.equal(c.autoStatus({ hasCheckIn: true, hasPlan: false, lateMinutes: 0 }), 'present') })
ok('autoStatus : sans arrivée, statut conservé / present par défaut', () => { assert.equal(c.autoStatus({ current: null, hasCheckIn: false, hasPlan: true, lateMinutes: 0 }), 'present') })

console.log(`\n${n} tests OK`)
