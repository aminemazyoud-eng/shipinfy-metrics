// Tests purs des preuves de livraison côté bureau (Sprint 20) — node --no-warnings --experimental-transform-types scripts/test-proofs.mjs
import assert from 'node:assert/strict'
import { lib } from './_ts-alias.mjs'

const v = await lib('ops-proof-view.ts')
const k = await lib('ops-kpis.ts')
const c = await lib('ops-config.ts')
let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name) }

ok('geoBadge : vert / orange / gris', () => {
  assert.deepEqual(v.geoBadge(120, true, 300), { tone: 'green', label: "Livré à 120 m de l'adresse" })
  assert.equal(v.geoBadge(450, false, 300).tone, 'orange')
  assert.equal(v.geoBadge(null, null, 300).tone, 'gray')
  assert.equal(v.geoBadge(undefined, true, 300).label, 'Position non enregistrée')
})
ok('geoBadge : seuil utilisé si ok absent, ok fait foi sinon, km au-delà de 1000 m', () => {
  assert.equal(v.geoBadge(300, null, 300).tone, 'green')
  assert.equal(v.geoBadge(301, null, 300).tone, 'orange')
  assert.equal(v.geoBadge(200, false, 300).tone, 'orange') // seuil d'époque plus strict
  assert.equal(v.geoBadge(1500, false, 300).label, "Livré à 1,5 km de l'adresse")
  assert.equal(v.geoBadge(NaN, true, 300).tone, 'gray')
})
ok('allowedProofMime : jpeg/png/webp uniquement', () => {
  assert.equal(v.allowedProofMime('image/jpeg'), 'image/jpeg')
  assert.equal(v.allowedProofMime('IMAGE/PNG'), 'image/png')
  assert.equal(v.allowedProofMime('image/webp; charset=x'), 'image/webp')
  for (const bad of ['image/svg+xml', 'text/html', 'application/pdf', '', null, undefined, 42]) assert.equal(v.allowedProofMime(bad), null)
})
ok('couverture des preuves', () => {
  const p = k.computeProofCoverage(40, 30)
  assert.equal(p.value, 75); assert.equal(p.num, 30); assert.equal(p.den, 40)
  assert.equal(k.computeProofCoverage(0, 0).value, null) // n/d, jamais 0
})
ok('conformité géographique (avec / sans position)', () => {
  const g = k.computeGeoCompliance([true, true, false, null, undefined, true, false, true])
  assert.equal(g.den, 6); assert.equal(g.num, 4); assert.equal(g.value, 66.7)
  assert.equal(g.noPositionPct, 25)
  const none = k.computeGeoCompliance([null, null])
  assert.equal(none.value, null); assert.equal(none.noPositionPct, 100)
  assert.equal(k.computeGeoCompliance([]).noPositionPct, null)
})
ok('actions application livreur', () => {
  const a = k.computeOfflineActions(200, 14)
  assert.equal(a.count, 200); assert.equal(a.failed, 14); assert.equal(a.failRate, 7)
  const z = k.computeOfflineActions(0, 0)
  assert.equal(z.count, null); assert.equal(z.failRate, null)
})
ok('paramètres : bornes des rayons et liste fermée proofRequired', () => {
  assert.equal(c.DEFAULT_CFG.geofenceMeters, 400); assert.equal(c.DEFAULT_CFG.deliveryGeofenceMeters, 400); assert.equal(c.DEFAULT_CFG.proofRequired, 'otp_or_photo')
  assert.equal(c.sanitizeCfgValue('geofenceMeters', 50), 50)
  assert.equal(c.sanitizeCfgValue('geofenceMeters', 2000), 2000)
  assert.equal(c.sanitizeCfgValue('geofenceMeters', 49), undefined)
  assert.equal(c.sanitizeCfgValue('deliveryGeofenceMeters', 2001), undefined)
  assert.equal(c.sanitizeCfgValue('deliveryGeofenceMeters', 'abc'), undefined)
  assert.equal(c.sanitizeCfgValue('proofRequired', 'photo'), 'photo')
  assert.equal(c.sanitizeCfgValue('proofRequired', 'otp'), 'otp')
  assert.equal(c.sanitizeCfgValue('proofRequired', 'rien'), undefined)
  assert.equal(c.sanitizeCfgValue('proofRequired', 5), undefined)
  assert.equal(c.sanitizeCfgValue('cashGapAlert', 10), 10) // paramètres existants inchangés
  assert.equal(c.sanitizeCfgValue('cashGapAlert', -1), undefined)
  c.setCfg({ geofenceMeters: 99999, proofRequired: 'photo' })
  assert.equal(c.CFG.geofenceMeters, 400); assert.equal(c.CFG.proofRequired, 'photo')
})
console.log(`\ntest-proofs : ${n} groupes de tests OK`)
