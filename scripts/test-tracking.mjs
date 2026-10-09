// Tests purs du suivi client (Sprint 19) — node --experimental-transform-types scripts/test-tracking.mjs
// (le flag est nécessaire car lib/env.ts utilise une « parameter property » TypeScript ; 'next/server' est simulé ci-dessous)
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({ resolve(spec, ctx, next) { return spec === 'next/server' ? { url: 'data:text/javascript,export const NextResponse={json:()=>({})}', shortCircuit: true } : next(spec, ctx) } })
import { lib } from './_ts-alias.mjs'

process.env.PLANNING_LINK_SECRET = 'x'.repeat(8) + 'secret-factice-pour-test-32c' // factice, >= 32 caractères
const t = await lib('ops-tracking.ts')
let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ok -', name) }

const FUTURE = Date.now() + 3_600_000
ok('jeton valide', () => {
  const tok = t.makeTrackToken('cmabc123', FUTURE)
  assert.equal(t.readTrackToken(tok), 'cmabc123')
})
ok('jeton altéré (signature, id, expiration)', () => {
  const [a, e, s] = t.makeTrackToken('cmabc123', FUTURE).split('.')
  assert.equal(t.readTrackToken(`${a}.${e}.${s.slice(0, -1)}${s.endsWith('0') ? '1' : '0'}`), null)
  assert.equal(t.readTrackToken(`${Buffer.from('autre').toString('base64url')}.${e}.${s}`), null)
  assert.equal(t.readTrackToken(`${a}.${Number(e) + 1000}.${s}`), null)
  assert.equal(t.readTrackToken('n.importe.quoi'), null)
  assert.equal(t.readTrackToken(''), null)
})
ok('jeton expiré', () => assert.equal(t.readTrackToken(t.makeTrackToken('cmabc123', Date.now() - 1000)), null))
ok('expiration = fin de créneau + 48 h', () => assert.equal(t.trackExpiry(new Date('2026-10-06T12:00:00Z')), Date.parse('2026-10-08T12:00:00Z')))
ok('le jeton ne contient aucune donnée personnelle', () => {
  const tok = t.makeTrackToken('cmabc123', FUTURE)
  assert.ok(/^[\w-]+\.\d+\.[0-9a-f]{32}$/.test(tok))
  assert.ok(!/@|\+212|0[67]\d{8}/.test(tok))
})
ok('sans secret : erreur explicite (pas de repli)', () => {
  const s = process.env.PLANNING_LINK_SECRET; delete process.env.PLANNING_LINK_SECRET
  assert.throws(() => t.makeTrackToken('x', FUTURE)); process.env.PLANNING_LINK_SECRET = s
})

const base = {
  reference: 'REF-1', externalId: 'EXT-1', status: 'START_DELIVERY', slotStart: new Date('2026-10-06T11:00:00Z'), slotEnd: new Date('2026-10-06T14:00:00Z'), slotLabel: '12-15',
  createdAtSrc: new Date('2026-10-06T08:00:00Z'), deliveredAt: null, noShowAt: null,
  events: [{ toStatus: 'ASSIGNED', at: new Date('2026-10-06T09:00:00Z') }, { toStatus: 'IN_TRANSPORT', at: new Date('2026-10-06T10:00:00Z') }, { toStatus: 'START_DELIVERY', at: new Date('2026-10-06T11:30:00Z') }],
  hubName: 'Marjane Morocco Mall', driverFirstName: 'Youssef Benali', rating: null,
  // champs interdits glissés volontairement dans l'entrée : ils ne doivent jamais ressortir
  address: '12 rue des Fleurs', customerPhone: '+212600000000', amount: 450, customerName: 'Fatima Z.', driverPhone: '+212611111111',
}
const FORBIDDEN = ['address', 'customerPhone', 'amount', 'customerName', 'driverPhone', 'phone', 'lastName', 'collectedAmount', 'lat', 'lng']
const keysDeep = (o, acc = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.push(k); keysDeep(v, acc) } return acc }

ok('DTO public : aucun champ interdit, aucune valeur sensible', () => {
  const v = t.toPublicView(base, { etaAt: '2026-10-06T13:00:00Z', otpCode: '4821' })
  const ks = keysDeep(v); for (const f of FORBIDDEN) assert.ok(!ks.includes(f), `champ interdit : ${f}`)
  const json = JSON.stringify(v)
  for (const s of ['rue des Fleurs', '+2126', 'Benali', 'Fatima', '450']) assert.ok(!json.includes(s), `fuite : ${s}`)
  assert.equal(v.driverFirstName, 'Youssef'); assert.equal(v.statusLabel, 'En livraison'); assert.equal(v.slot, '12h – 15h')
})
ok('code de remise et ETA : seulement IN_TRANSPORT / START_DELIVERY', () => {
  for (const st of ['IN_TRANSPORT', 'START_DELIVERY']) { const v = t.toPublicView({ ...base, status: st }, { etaAt: 'E', otpCode: '1234' }); assert.equal(v.deliveryCode, '1234'); assert.equal(v.etaAt, 'E') }
  for (const st of ['READY_PICKUP', 'ASSIGNED', 'DELIVERED', 'NO_SHOW', 'CANCELLED']) { const v = t.toPublicView({ ...base, status: st }, { etaAt: 'E', otpCode: '1234' }); assert.equal(v.deliveryCode, null); assert.equal(v.etaAt, null) }
})
ok('étapes : heures franchies seulement, sans nom', () => {
  const v = t.toPublicView(base)
  assert.deepEqual(v.steps.map(s => s.key), ['RECEIVED', 'ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY'])
  assert.deepEqual(Object.keys(v.steps[0]).sort(), ['at', 'key', 'label'])
})
ok('livrée : indicateur delivered + note', () => {
  const v = t.toPublicView({ ...base, status: 'DELIVERED', deliveredAt: new Date('2026-10-06T12:30:00Z'), rating: 4 })
  assert.equal(v.delivered, true); assert.equal(v.rating, 4); assert.equal(v.statusLabel, 'Livrée')
})
ok('commentaire nettoyé (HTML, contrôle, 300 car.)', () => {
  assert.equal(t.cleanComment('<script>alert(1)</script>Super  <b>livreur</b>'), 'alert(1) Super livreur')
  assert.equal(t.cleanComment('a'.repeat(500)).length, 300)
  assert.equal(t.cleanComment('   '), null); assert.equal(t.cleanComment(42), null)
})
console.log(`\n${n} tests OK`)
