// Tests purs de l'API de l'application livreur — Sprint 20. Aucun accès base, aucun serveur.
// node --no-warnings --experimental-transform-types scripts/test-driver-api.mjs   (PLANNING_LINK_SECRET factice défini ci-dessous)
import assert from 'node:assert/strict'

process.env.PLANNING_LINK_SECRET = 'a'.repeat(32)
const { lib } = await import('./_ts-alias.mjs')
// 'next/server' n'a pas de table « exports » : Node ESM exige l'extension (lib/env.ts et le jeton l'importent)
const { registerHooks } = await import('node:module')
registerHooks({ resolve(spec, ctx, next) { return next(spec === 'next/server' ? 'next/server.js' : spec, ctx) } })
const tok = await lib('ops-driver-token.ts')
const act = await lib('ops-driver-actions.ts')
const geo = await lib('geo.ts')
let n = 0
const t = (name, fn) => { fn(); n++; console.log('  ok -', name) }

// ── Jeton ──
const now = Date.UTC(2026, 9, 9, 10, 0, 0)
t('jeton : valide pour le bon tokenVersion', () => {
  const k = tok.makeDriverToken('D01', 1, now)
  const c = tok.readDriverToken(k)
  assert.equal(c.driverCode, 'D01')
  assert.equal(c.exp, now + 30 * 86_400_000)
  assert.ok(tok.verifyDriverToken(c, 1, now + 1000))
})
t('jeton : révoqué (tokenVersion différent) refusé', () => {
  const c = tok.readDriverToken(tok.makeDriverToken('D01', 1, now))
  assert.ok(!tok.verifyDriverToken(c, 2, now))
})
t('jeton : expiré refusé (30 jours + 1 ms)', () => {
  const c = tok.readDriverToken(tok.makeDriverToken('D01', 1, now))
  assert.ok(tok.verifyDriverToken(c, 1, c.exp))
  assert.ok(!tok.verifyDriverToken(c, 1, c.exp + 1))
})
t('jeton : altéré (code livreur, expiration, signature) refusé', () => {
  const [c, e, s] = tok.makeDriverToken('D01', 1, now).split('.')
  const other = Buffer.from('D02').toString('base64url')
  assert.ok(!tok.verifyDriverToken(tok.readDriverToken(`${other}.${e}.${s}`), 1, now), 'autre livreur')
  assert.ok(!tok.verifyDriverToken(tok.readDriverToken(`${c}.${Number(e) + 86_400_000}.${s}`), 1, now), 'expiration prolongée')
  const flipped = s.slice(0, -1) + (s.endsWith('0') ? '1' : '0')
  assert.ok(!tok.verifyDriverToken(tok.readDriverToken(`${c}.${e}.${flipped}`), 1, now), 'signature modifiée')
})
t('jeton : formats illisibles rejetés', () => {
  for (const bad of [undefined, null, '', 'abc', 'a.b', 'a.b.c.d', 'RDAx.123.zz', 'x'.repeat(500)]) assert.equal(tok.readDriverToken(bad), null)
  assert.ok(!tok.verifyDriverToken(null, 1, now))
})
t('jeton : secret différent => refusé', () => {
  const k = tok.makeDriverToken('D01', 1, now)
  process.env.PLANNING_LINK_SECRET = 'b'.repeat(32)
  assert.ok(!tok.verifyDriverToken(tok.readDriverToken(k), 1, now))
  process.env.PLANNING_LINK_SECRET = 'a'.repeat(32)
  assert.ok(tok.verifyDriverToken(tok.readDriverToken(k), 1, now))
})
t('jeton : secret absent => erreur (jamais de repli)', () => {
  process.env.PLANNING_LINK_SECRET = 'court'
  assert.throws(() => tok.makeDriverToken('D01', 1))
  process.env.PLANNING_LINK_SECRET = 'a'.repeat(32)
})

// ── Machine à états ──
t('nextStatus : transitions autorisées', () => {
  assert.equal(act.nextStatus('accept', 'ASSIGNED'), 'IN_TRANSPORT')
  assert.equal(act.nextStatus('start', 'IN_TRANSPORT'), 'START_DELIVERY')
  assert.equal(act.nextStatus('deliver', 'START_DELIVERY'), 'DELIVERED')
  assert.equal(act.nextStatus('noshow', 'START_DELIVERY'), 'NO_SHOW')
})
t('nextStatus : aucune étape sautée, aucun retour, aucun rejeu', () => {
  const ok = { accept: 'ASSIGNED', start: 'IN_TRANSPORT', deliver: 'START_DELIVERY', noshow: 'START_DELIVERY' }
  const all = ['READY_PICKUP', 'ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY', 'DELIVERED', 'NO_SHOW', 'CANCELLED']
  for (const type of Object.keys(ok)) for (const st of all) if (st !== ok[type]) assert.equal(act.nextStatus(type, st), null, `${type} depuis ${st}`)
  assert.equal(act.nextStatus('checkin', 'ASSIGNED'), null)
  assert.equal(act.nextStatus('inconnu', 'ASSIGNED'), null)
})

// ── Horodatage borné ──
t('clampClientTime : heure client valide conservée', () => {
  const at = new Date(now - 60_000)
  assert.equal(act.clampClientTime(at.toISOString(), now, new Date(now - 3_600_000)).getTime(), at.getTime())
})
t('clampClientTime : futur > 5 min => heure serveur ; <= 5 min conservé', () => {
  assert.equal(act.clampClientTime(new Date(now + 6 * 60_000).toISOString(), now, null).getTime(), now)
  assert.equal(act.clampClientTime(new Date(now + 4 * 60_000).toISOString(), now, null).getTime(), now + 4 * 60_000)
})
t('clampClientTime : antérieur au dernier événement => heure serveur', () => {
  assert.equal(act.clampClientTime(new Date(now - 7_200_000).toISOString(), now, new Date(now - 3_600_000)).getTime(), now)
})
t('clampClientTime : illisible / absent => heure serveur', () => {
  assert.equal(act.clampClientTime('pas une date', now, null).getTime(), now)
  assert.equal(act.clampClientTime(undefined, now, null).getTime(), now)
})

// ── Preuves ──
t('proofRequirementMet : otp_or_photo / photo / otp', () => {
  const m = act.proofRequirementMet
  assert.ok(m('otp_or_photo', { otpValid: true, photoCount: 0 }))
  assert.ok(m('otp_or_photo', { otpValid: false, photoCount: 1 }))
  assert.ok(!m('otp_or_photo', { otpValid: false, photoCount: 0 }))
  assert.ok(m('photo', { otpValid: false, photoCount: 2 }) && !m('photo', { otpValid: true, photoCount: 0 }))
  assert.ok(m('otp', { otpValid: true, photoCount: 0 }) && !m('otp', { otpValid: false, photoCount: 3 }))
})
t('noShowRequirementMet : motif >= 3 car. ET photo', () => {
  assert.ok(act.noShowRequirementMet('Client absent', 1))
  assert.ok(!act.noShowRequirementMet('ab', 1))
  assert.ok(!act.noShowRequirementMet('   ', 1))
  assert.ok(!act.noShowRequirementMet('Client absent', 0))
  assert.ok(!act.noShowRequirementMet(undefined, 2))
})
t('parseAction : forme', () => {
  assert.ok('action' in act.parseAction({ id: 'abcdefgh1234', type: 'accept', orderId: 'o1', at: '2026-10-09T10:00:00Z' }))
  assert.ok('error' in act.parseAction({ id: 'court', type: 'accept', orderId: 'o1' }))
  assert.ok('error' in act.parseAction({ id: 'abcdefgh1234', type: 'teleport' }))
  assert.ok('error' in act.parseAction({ id: 'abcdefgh1234', type: 'deliver' }), 'orderId requis')
  assert.ok('action' in act.parseAction({ id: 'abcdefgh1234', type: 'checkin', geo: { lat: 33.5, lng: -7.6, accuracy: 12 } }))
  const a = act.parseAction({ id: 'abcdefgh1234', type: 'deliver', orderId: 'o', geo: { lat: 'x', lng: 1 }, otp: ' 1234 ' }).action
  assert.equal(a.geo, undefined); assert.equal(a.otp, '1234')
})
t('shortName : prénom + initiale', () => {
  assert.equal(act.shortName('Karim Benali'), 'Karim B.')
  assert.equal(act.shortName('Karim'), 'Karim')
  assert.equal(act.shortName(null), '')
})

// ── Géolocalisation ──
t('haversine : distances connues', () => {
  assert.equal(Math.round(geo.haversineM(33.5731, -7.5898, 33.5731, -7.5898)), 0)
  const casaRabat = geo.haversineM(33.5731, -7.5898, 34.0209, -6.8416) / 1000
  assert.ok(casaRabat > 85 && casaRabat < 95, 'Casablanca-Rabat ~ 87 km : ' + casaRabat)
  const d100 = geo.haversineM(33.0, -7.0, 33.0, -7.0 + 100 / (111_320 * Math.cos(33 * Math.PI / 180)))
  assert.ok(Math.abs(d100 - 100) < 1, '100 m : ' + d100)
})
t('geoCheck : dans / hors rayon, données manquantes => null', () => {
  const target = { lat: 33.5731, lng: -7.5898 }
  const near = geo.geoCheck({ lat: 33.5740, lng: -7.5898 }, target, 300) // ~100 m
  assert.equal(near.ok, true); assert.ok(near.distanceM > 90 && near.distanceM < 110)
  assert.equal(geo.geoCheck({ lat: 33.60, lng: -7.5898 }, target, 300).ok, false)
  assert.equal(geo.geoCheck(undefined, target, 300), null)
  assert.equal(geo.geoCheck({ lat: 33.5, lng: -7.5 }, { lat: null, lng: null }, 300), null)
  assert.equal(geo.geoCheck({ lat: 0, lng: 0 }, target, 300), null, 'point nul rejeté')
  assert.equal(geo.geoCheck({ lat: 95, lng: 0 }, target, 300), null)
})

// ── Signature d'image ──
t('sniffImage : JPEG / PNG / WEBP reconnus, le reste refusé', () => {
  assert.equal(geo.sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), 'image/jpeg')
  assert.equal(geo.sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png')
  assert.equal(geo.sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56])), 'image/webp')
  assert.equal(geo.sniffImage(Buffer.from('MZ\x90\x00 exécutable renommé')), null)
  assert.equal(geo.sniffImage(Buffer.from('<svg onload=alert(1)>')), null)
  assert.equal(geo.sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45, 0])), null, 'RIFF WAVE')
  assert.equal(geo.sniffImage(new Uint8Array(0)), null)
})

console.log(`\n${n} tests OK`)
