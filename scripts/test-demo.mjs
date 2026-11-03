// scripts/test-demo.mjs — logique pure du générateur de données de test (lib/ops-demo.ts), sans base. Usage : node scripts/test-demo.mjs
import assert from 'node:assert/strict'
import { buildDemoPlan, summarize, DEMO_MIX } from '../lib/ops-demo.ts'

const H = 3_600_000
const now = Date.UTC(2026, 10, 3, 14, 0) // 3 nov. 2026 14:00 UTC
const dayStart = Date.UTC(2026, 10, 3, 0, 0)
const mk = (d) => [9, 12, 15, 18].map((h, i, a) => ({ label: `${String(h).padStart(2, '0')}-${String(a[i + 1] ?? h + 3).padStart(2, '0')}`, startMs: d + h * H, endMs: d + (a[i + 1] ?? h + 3) * H }))
const daySlots = mk(dayStart)
const allSlots = [-5, -4, -3, -2, -1, 0, 1].flatMap(k => mk(dayStart + k * 24 * H))
const hubs = [
  { code: 'CAS-MM', city: 'CASABLANCA', lat: 33.58, lng: -7.62, drivers: [{ id: 'd1', code: 'D01' }, { id: 'd2', code: 'D02' }] },
  { code: 'MRK-GZ', city: 'MARRAKECH', lat: null, lng: null, drivers: [{ id: 'd3', code: 'D03' }] },
  { code: 'AGA-01', city: 'AGADIR', lat: 30.4, lng: -9.6, drivers: [] },
]
const inp = { day: '2026-11-03', count: 300, nowMs: now, hubs, daySlots, allSlots, dayStartMs: dayStart, dayEndMs: dayStart + 24 * H, reasonCodes: ['ABSENT', 'ADRESSE'] }
const { specs, warnings } = buildDemoPlan(inp)

// total, déterminisme, unicité
assert.equal(specs.length, 300)
assert.equal(new Set(specs.map(s => s.externalId)).size, 300)
assert.deepEqual(buildDemoPlan(inp).specs.map(s => s.externalId + s.status + s.amount), specs.map(s => s.externalId + s.status + s.amount))
assert.ok(specs.every(s => s.externalId.startsWith('DEMO-') && s.customerPhone.startsWith('060000') && s.customerPhone.length === 10))
assert.ok(warnings.some(w => w.includes('AGA-01')))
assert.ok(specs.filter(s => s.hubCode === 'AGA-01').every(s => !s.driverId))

// répartition (hub sans livreur → tout « non assignée », donc on teste sur un hub avec livreurs)
const one = buildDemoPlan({ ...inp, count: 200, hubs: [hubs[0]] }).specs
const c = summarize(one)
for (const m of DEMO_MIX) assert.ok(Math.abs((c[m.cat] ?? 0) - 2 * m.pct) <= 1, `${m.cat}: ${c[m.cat]}`)
const pending = one.filter(s => s.status === 'DELIVERED' && !s.collectedAt)
assert.equal(pending.length, 90)
assert.ok(pending.filter(s => now - s.deliveredAt.getTime() > 24 * H).length >= 45)
assert.ok(pending.filter(s => now - s.deliveredAt.getTime() > 48 * H).length >= 15)

// montants, chaînes, cohérence
const ORDER = ['READY_PICKUP', 'ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY']
for (const s of specs) {
  assert.ok(s.amount >= 80 && s.amount <= 900 && s.amount % 5 === 0)
  const ev = s.events
  assert.equal(ev[0].fromStatus, null); assert.equal(ev[0].toStatus, 'READY_PICKUP')
  for (let i = 1; i < ev.length; i++) { assert.equal(ev[i].fromStatus, ev[i - 1].toStatus); assert.ok(ev[i].at > ev[i - 1].at, `${s.externalId} horodatages`) }
  assert.ok(ev.every(e => e.at.getTime() <= now), `${s.externalId} dans le futur`)
  const path = ev.map(e => e.toStatus)
  const need = s.status === 'DELIVERED' || s.status === 'NO_SHOW' ? [...ORDER, s.status] : s.status === 'CANCELLED' ? ['READY_PICKUP', 'CANCELLED'] : ORDER.slice(0, ORDER.indexOf(s.status) + 1)
  assert.deepEqual(path.filter(p => p !== 'COLLECTED'), need, `${s.externalId} étapes`)
  assert.equal(path.includes('COLLECTED'), !!s.collectedAt)
  if (s.status === 'DELIVERED') { assert.ok(s.deliveredAt && s.driverId) }
  if (s.collectedAt) { assert.ok(['especes', 'carte', 'virement'].includes(s.collectionMethod)); assert.equal(s.collectedAmount, s.amount); assert.ok(s.collectedAt > s.deliveredAt) }
  if (s.status === 'NO_SHOW') assert.ok(s.reasonCode)
  assert.ok(s.slotEnd > s.slotStart)
}
// jour passé : tout reste dans le passé et cohérent
const past = buildDemoPlan({ ...inp, day: '2026-11-01', daySlots: mk(dayStart - 2 * 24 * H), dayStartMs: dayStart - 2 * 24 * H, dayEndMs: dayStart - 24 * H, count: 40, hubs: [hubs[0]] }).specs
assert.equal(past.length, 40)
assert.ok(past.every(s => s.events.every(e => e.at.getTime() <= now)))
console.log('test-demo OK —', specs.length, 'commandes,', JSON.stringify(summarize(specs)))
