// Tests PURS de la clôture mensuelle de la paie (aucune base) — node scripts/test-payrun.mjs
import assert from 'node:assert/strict'
import { lib } from './_ts-alias.mjs'

const c = await lib('ops-payrun-core.ts')
let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name) }

ok('periodRange : bornes du mois (février bissextile / 31 jours)', () => {
  assert.deepEqual(c.periodRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' })
  assert.deepEqual(c.periodRange('2026-10'), { from: '2026-10-01', to: '2026-10-31' })
})
ok('isPeriod : format strict AAAA-MM', () => {
  assert.ok(c.isPeriod('2026-10')); assert.ok(!c.isPeriod('2026-13')); assert.ok(!c.isPeriod('26-10')); assert.ok(!c.isPeriod('2026-10-01')); assert.ok(!c.isPeriod(null))
})
ok('finalOf : final = net + ajustement (arrondi 2 décimales)', () => {
  assert.equal(c.finalOf(1000, 50), 1050); assert.equal(c.finalOf(1000, -120.5), 879.5); assert.equal(c.finalOf(0.1, 0.2), 0.3)
})
ok('totalsOf : sommes et final incluant les ajustements', () => {
  const t = c.totalsOf([
    { gross: 1000, bonus: 100, deductions: 20, net: 1080, adjustment: 50, final: 1130, delivered: 10 },
    { gross: 500, bonus: 0, deductions: 0, net: 500, adjustment: -30, final: 470, delivered: 4 },
  ])
  assert.deepEqual(t, { gross: 1500, bonus: 100, deductions: 20, net: 1580, adjustments: 20, final: 1600, delivered: 14, people: 2 })
})
ok('transitions autorisées', () => {
  assert.deepEqual(c.nextStatus(null, 'draft'), { ok: true, to: 'draft' })
  assert.deepEqual(c.nextStatus('draft', 'draft'), { ok: true, to: 'draft' })
  assert.deepEqual(c.nextStatus('draft', 'validate'), { ok: true, to: 'validated' })
  assert.deepEqual(c.nextStatus('validated', 'paid'), { ok: true, to: 'paid' })
  assert.deepEqual(c.nextStatus('validated', 'reopen'), { ok: true, to: 'draft' })
  assert.deepEqual(c.nextStatus('draft', 'adjust'), { ok: true, to: 'draft' })
})
ok('transitions interdites (recalcul d’un mois validé/payé, valider sans brouillon, payer un brouillon, rouvrir un payé…)', () => {
  for (const s of ['validated', 'paid']) assert.equal(c.nextStatus(s, 'draft').ok, false)
  assert.equal(c.nextStatus(null, 'validate').ok, false)
  assert.equal(c.nextStatus('validated', 'validate').ok, false)
  assert.equal(c.nextStatus('draft', 'paid').ok, false)
  assert.equal(c.nextStatus('paid', 'paid').ok, false)
  assert.equal(c.nextStatus('paid', 'reopen').ok, false)
  assert.equal(c.nextStatus('draft', 'reopen').ok, false)
  assert.match(c.nextStatus('paid', 'draft').error, /rouvrir/)
})
ok('ajustement : refusé hors brouillon', () => {
  const line = { net: 1000 }
  for (const s of ['validated', 'paid', null]) assert.equal(c.applyAdjustment(s, line, 10, 'prime').ok, false)
  const r = c.applyAdjustment('draft', line, 150, 'prime exceptionnelle')
  assert.ok(r.ok); assert.equal(r.line.final, 1150); assert.equal(r.line.adjustment, 150)
})
ok('ajustement : note obligatoire si ≠ 0, borne ±5000, nombre fini', () => {
  assert.equal(c.checkAdjustment(50, '').ok, false)
  assert.equal(c.checkAdjustment(50, '   ').ok, false)
  assert.ok(c.checkAdjustment(0, '').ok)
  assert.ok(c.checkAdjustment(5000, 'max').ok); assert.ok(c.checkAdjustment(-5000, 'max').ok)
  assert.equal(c.checkAdjustment(5000.01, 'trop').ok, false); assert.equal(c.checkAdjustment(-5001, 'trop').ok, false)
  for (const bad of [NaN, Infinity, '12', null, undefined]) assert.equal(c.checkAdjustment(bad, 'x').ok, false)
})
ok('ajustement 0 : efface la note, final = net', () => {
  const r = c.applyAdjustment('draft', { net: 800 }, 0, 'ancienne note'); assert.ok(r.ok); assert.equal(r.line.adjustmentNote, null); assert.equal(r.line.final, 800)
})
console.log(`\n${n} tests OK`)
