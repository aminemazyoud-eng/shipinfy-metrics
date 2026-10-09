// Tests purs de l'application livreur (sans navigateur) :
//   node --no-warnings --experimental-transform-types --import ./scripts/_ts-alias.mjs scripts/test-driver-offline.mjs
import assert from 'node:assert/strict'
import './_ts-alias.mjs'
import { lib } from './_ts-alias.mjs'

const off = await lib('driver-offline.ts')
const i18n = await lib('driver-i18n.ts')
const img = await lib('image-compress.ts')

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ok', name) }

// ── machine à états locale ──
ok('transitions valides', () => {
  assert.equal(off.nextStatus('ASSIGNED', 'accept'), 'IN_TRANSPORT')
  assert.equal(off.nextStatus('IN_TRANSPORT', 'start'), 'START_DELIVERY')
  assert.equal(off.nextStatus('START_DELIVERY', 'deliver'), 'DELIVERED')
  assert.equal(off.nextStatus('START_DELIVERY', 'noshow'), 'NO_SHOW')
})
ok('transitions interdites', () => {
  assert.equal(off.nextStatus('ASSIGNED', 'start'), null)
  assert.equal(off.nextStatus('ASSIGNED', 'deliver'), null)
  assert.equal(off.nextStatus('IN_TRANSPORT', 'deliver'), null)
  assert.equal(off.nextStatus('DELIVERED', 'noshow'), null)
  assert.equal(off.nextStatus('NO_SHOW', 'accept'), null)
})
ok('checkin/checkout ne changent pas le statut', () => assert.equal(off.nextStatus('ASSIGNED', 'checkin'), 'ASSIGNED'))
ok('nextAction', () => {
  assert.equal(off.nextAction('ASSIGNED'), 'accept'); assert.equal(off.nextAction('DELIVERED'), null)
})

const mk = (o) => ({ tries: 0, state: 'pending', at: '2026-10-09T08:00:00Z', ...o })
ok('statut optimiste = base + actions en file (erreurs ignorées)', () => {
  const q = [mk({ id: 'a', seq: 1, type: 'accept', orderId: 'o1' }), mk({ id: 'b', seq: 2, type: 'start', orderId: 'o1' })]
  assert.equal(off.effectiveStatus('ASSIGNED', q), 'START_DELIVERY')
  q[1].state = 'error'
  assert.equal(off.effectiveStatus('ASSIGNED', q), 'IN_TRANSPORT')
  assert.equal(off.effectiveStatus('ASSIGNED', [mk({ id: 'c', seq: 1, type: 'deliver', orderId: 'o1' })]), 'ASSIGNED') // invalide ignorée
})
ok('effectiveOrders: badge en attente / erreur', () => {
  const orders = [{ id: 'o1', ref: 'R1', status: 'ASSIGNED' }, { id: 'o2', ref: 'R2', status: 'ASSIGNED' }]
  const v = off.effectiveOrders(orders, [mk({ id: 'a', seq: 1, type: 'accept', orderId: 'o1' })])
  assert.equal(v[0].status, 'IN_TRANSPORT'); assert.equal(v[0].localPending, true); assert.equal(v[1].localPending, false)
})
ok('validation deliver / noshow', () => {
  assert.equal(off.validateAction('deliver', { otp: '1234', proofCount: 0 }), null)
  assert.equal(off.validateAction('deliver', { otp: '', proofCount: 1 }), null)
  assert.equal(off.validateAction('deliver', { otp: '12', proofCount: 0 }), 'deliver.need')
  assert.equal(off.validateAction('noshow', { reason: 'ab', proofCount: 1 }), 'noshow.need')
  assert.equal(off.validateAction('noshow', { reason: 'abc', proofCount: 0 }), 'noshow.need')
  assert.equal(off.validateAction('noshow', { reason: 'abc', proofCount: 1 }), null)
})

// ── file : ordre, idempotence ──
ok('selectSendable: ordre par seq, ids uniques', () => {
  const q = [mk({ id: 'b', seq: 2, type: 'start', orderId: 'o1' }), mk({ id: 'a', seq: 1, type: 'accept', orderId: 'o1' }), mk({ id: 'a', seq: 1, type: 'accept', orderId: 'o1' })]
  assert.deepEqual(off.selectSendable(q).map(x => x.id), ['a', 'b'])
})
ok('selectSendable: erreur bloque la même commande seulement', () => {
  const q = [mk({ id: 'a', seq: 1, type: 'deliver', orderId: 'o1', state: 'error', errorCode: 'OTP_INVALID' }), mk({ id: 'b', seq: 2, type: 'accept', orderId: 'o1' }),
    mk({ id: 'c', seq: 3, type: 'accept', orderId: 'o2' }), mk({ id: 'd', seq: 4, type: 'checkin' })]
  assert.deepEqual(off.selectSendable(q).map(x => x.id), ['c', 'd'])
})
ok('buildSyncBody: champs propres, pas de champs internes', () => {
  const b = off.buildSyncBody([mk({ id: 'a', seq: 1, type: 'deliver', orderId: 'o1', otp: '1234', proofClientIds: ['p1'], geo: { lat: 1, lng: 2 } })])
  assert.deepEqual(Object.keys(b.actions[0]).sort(), ['at', 'geo', 'id', 'orderId', 'otp', 'proofClientIds', 'type'])
})
ok('idempotence: un id traité n est plus renvoyé; un envoi interrompu est rejoué avec le MÊME id', () => {
  let q = [mk({ id: 'a', seq: 1, type: 'accept', orderId: 'o1' }), mk({ id: 'b', seq: 2, type: 'start', orderId: 'o1' })]
  q = off.markSending(q, ['a', 'b'], 'T1')
  assert.equal(q[0].tries, 1)
  // réponse perdue : retour réseau → pending, mêmes ids
  const q2 = off.releaseSending(q, ['a', 'b'])
  assert.deepEqual(off.selectSendable(q2).map(x => x.id), ['a', 'b'])
  // réponse reçue : a ok, b ok → file vide, plus rien à envoyer
  const out = off.applyResults(q, ['a', 'b'], [{ id: 'a', ok: true }, { id: 'b', ok: true }], 'T2')
  assert.equal(out.queue.length, 0); assert.deepEqual(out.removed, ['a', 'b']); assert.equal(out.resync, true)
  assert.deepEqual(off.selectSendable(out.queue), [])
})
ok('applyResults: BAD_STATE retiré + resync + avis; OTP_INVALID en erreur; id absent → pending', () => {
  const q = off.markSending([
    mk({ id: 'a', seq: 1, type: 'accept', orderId: 'o1' }), mk({ id: 'b', seq: 2, type: 'deliver', orderId: 'o2', otp: '0000' }), mk({ id: 'c', seq: 3, type: 'checkin' }), mk({ id: 'z', seq: 4, type: 'checkout' }),
  ], ['a', 'b', 'c', 'z'], 'T')
  const out = off.applyResults(q, ['a', 'b', 'c', 'z'], [{ id: 'a', ok: false, code: 'BAD_STATE' }, { id: 'b', ok: false, code: 'OTP_INVALID' }, { id: 'c', ok: false, code: 'PERIOD_LOCKED' }], 'T2')
  assert.deepEqual(out.removed, ['a']); assert.equal(out.resync, true)
  const by = Object.fromEntries(out.queue.map(x => [x.id, x]))
  assert.equal(by.b.state, 'error'); assert.equal(by.b.errorCode, 'OTP_INVALID'); assert.equal(by.b.tries, 1) // pas d'incrément automatique en plus
  assert.equal(by.c.errorCode, 'PERIOD_LOCKED'); assert.equal(by.z.state, 'pending')
  assert.deepEqual(out.notices.map(x => x.code), ['BAD_STATE', 'OTP_INVALID', 'PERIOD_LOCKED'])
})
ok('retryWithOtp: seulement OTP_INVALID, code valide, même id', () => {
  const q = [mk({ id: 'b', seq: 1, type: 'deliver', orderId: 'o2', otp: '0000', state: 'error', errorCode: 'OTP_INVALID', tries: 1 }), mk({ id: 'c', seq: 2, type: 'checkin', state: 'error', errorCode: 'PERIOD_LOCKED' })]
  assert.equal(off.retryWithOtp(q, 'b', '12'), q)
  const r = off.retryWithOtp(q, 'b', '4321')
  assert.equal(r[0].state, 'pending'); assert.equal(r[0].otp, '4321'); assert.equal(r[0].id, 'b'); assert.equal(r[0].tries, 1)
  assert.equal(off.retryWithOtp(q, 'c', '4321')[1].state, 'error')
})
ok('newId unique, format uuid', () => {
  const s = new Set(Array.from({ length: 200 }, () => off.newId()))
  assert.equal(s.size, 200); assert.match([...s][0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
ok('backoff 1s,2s,4s', () => assert.deepEqual([1, 2, 3].map(off.backoffMs), [1000, 2000, 4000]))
ok('pendingCount ignore les erreurs', () => assert.equal(off.pendingCount([mk({ id: 'a', seq: 1, type: 'accept' }), mk({ id: 'b', seq: 2, type: 'accept', state: 'error' })]), 1))

// ── tri / urgence ──
ok('sortToday par fin de créneau, retards rouges / ambre < 45 min', () => {
  const now = Date.parse('2026-10-09T10:00:00Z')
  const o = (id, end, st = 'ASSIGNED') => ({ id, ref: id, status: st, slotEnd: end, lateMin: null })
  const list = [o('c', null), o('b', '2026-10-09T12:00:00Z'), o('a', '2026-10-09T09:30:00Z'), o('d', '2026-10-09T10:30:00Z'), o('x', '2026-10-09T08:00:00Z', 'DELIVERED')]
  assert.deepEqual(off.sortToday(list).map(x => x.id), ['a', 'd', 'b', 'c'])
  assert.equal(off.urgency(list[2], now).level, 'late'); assert.equal(off.urgency(list[2], now).min, 30)
  assert.equal(off.urgency(list[3], now).level, 'soon'); assert.equal(off.urgency(list[1], now).level, 'ok')
  assert.deepEqual(off.sortDone(list).map(x => x.id), ['x'])
})

// ── erreurs ──
const FR = i18n.FR, AR = i18n.AR
ok('codes d erreur → messages existants (FR et AR)', () => {
  for (const c of [...off.ERROR_CODES, 'XYZ', undefined]) { const k = off.errorKey(c); assert.ok(k in FR, k); assert.ok(AR[k], k) }
  assert.equal(off.errorKey('OTP_INVALID'), 'err.OTP_INVALID'); assert.equal(off.errorKey('???'), 'err.UNKNOWN')
  assert.equal(off.httpErrorCode(401), 'UNAUTHORIZED'); assert.equal(off.httpErrorCode(429), 'RATE'); assert.equal(off.httpErrorCode(500), 'NETWORK'); assert.equal(off.httpErrorCode(413), 'PROOF_REJECTED')
})

// ── dictionnaire ──
ok('toutes les clés FR existent en AR (et inversement), non vides', () => {
  const fk = Object.keys(FR), ak = Object.keys(AR)
  assert.deepEqual(fk.filter(k => !(k in AR)), []); assert.deepEqual(ak.filter(k => !(k in FR)), [])
  for (const k of fk) assert.ok(AR[k].trim().length > 0, k)
})
ok('paramètres {x} identiques FR/AR', () => {
  const ph = s => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
  for (const k of Object.keys(FR)) assert.equal(ph(AR[k]), ph(FR[k]), k)
})
ok('tr + detectLang', () => {
  assert.equal(i18n.tr('fr', 'net.pending', { n: 3 }), '3 en attente'); assert.match(i18n.tr('ar', 'net.pending', { n: 3 }), /^3 /)
  assert.equal(i18n.tr('ar', 'inconnue'), 'inconnue')
  assert.equal(i18n.detectLang('ar', 'fr-FR'), 'ar'); assert.equal(i18n.detectLang(null, 'ar-MA'), 'ar'); assert.equal(i18n.detectLang(undefined, 'en-US'), 'fr'); assert.equal(i18n.detectLang('fr', 'ar'), 'fr')
})

// ── compression ──
ok('pickQuality', () => {
  assert.equal(img.pickQuality(100 * 1024, 300), img.Q_MAX)
  const q1 = img.pickQuality(400 * 1024, 300), q2 = img.pickQuality(600 * 1024, 300)
  assert.ok(q1 < img.Q_MAX && q2 < q1, `${q1} ${q2}`)
  assert.equal(img.pickQuality(50_000_000, 300), img.Q_MIN)
  assert.ok(img.pickQuality(310 * 1024, 300) > q1)
  assert.equal(img.pickQuality(0, 300), img.Q_MAX)
})
ok('fitWidth + base64Bytes', () => {
  assert.deepEqual(img.fitWidth(4000, 3000), { w: 1024, h: 768 }); assert.deepEqual(img.fitWidth(800, 600), { w: 800, h: 600 })
  assert.equal(img.base64Bytes(Buffer.from('hello world!!').toString('base64')), 13)
})

console.log(`\n${n} tests OK`)
