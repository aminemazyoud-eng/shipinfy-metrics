// Tests purs du code de remise (OTP), de l'ETA v1 et du CSAT — Sprint 19. Aucun accès base.
// node scripts/test-otp-eta.mjs   (PLANNING_LINK_SECRET factice défini ci-dessous si absent)
import assert from 'node:assert/strict'

process.env.PLANNING_LINK_SECRET = 'a'.repeat(32)
const { lib } = await import('./_ts-alias.mjs')
// lib/env.ts utilise une « parameter property » TypeScript (non supportée par le strip-only de Node) : on la remplace par un équivalent
// strictement identique (refus d'un secret absent ou < 16 caractères) UNIQUEMENT pour ce test.
const { registerHooks } = await import('node:module')
const envStub = 'data:text/javascript,' + encodeURIComponent("export function requireEnv(n){const v=process.env[n];if(!v||v.length<16)throw new Error('manquante '+n);return v}")
registerHooks({ resolve(spec, ctx, next) { return spec === '@/lib/env' ? { url: envStub, shortCircuit: true } : next(spec, ctx) } })
const otp = await lib('ops-otp.ts')
const eta = await lib('ops-eta.ts')
const kpis = await lib('ops-kpis.ts')
let n = 0
const t = (name, fn) => { fn(); n++; console.log('  ok -', name) }

// ── OTP ──
t('otpCodeFor : 4 chiffres, déterministe', () => {
  for (let i = 0; i < 200; i++) assert.match(otp.otpCodeFor('ord' + i), /^\d{4}$/)
  assert.equal(otp.otpCodeFor('abc'), otp.otpCodeFor('abc'))
})
t('otpCodeFor : varie selon la commande (>= 150 codes distincts sur 200)', () => {
  const s = new Set(Array.from({ length: 200 }, (_, i) => otp.otpCodeFor('ord' + i)))
  assert.ok(s.size >= 150, 'distincts: ' + s.size)
  assert.notEqual(otp.otpCodeFor('A'), otp.otpCodeFor('B'))
})
t('otpCodeFor : varie selon le secret', () => {
  const a = Array.from({ length: 20 }, (_, i) => otp.otpCodeFor('o' + i))
  process.env.PLANNING_LINK_SECRET = 'b'.repeat(32)
  const b = Array.from({ length: 20 }, (_, i) => otp.otpCodeFor('o' + i))
  process.env.PLANNING_LINK_SECRET = 'a'.repeat(32)
  assert.ok(a.some((c, i) => c !== b[i]))
})
t('secret absent ou trop court : erreur', () => {
  process.env.PLANNING_LINK_SECRET = 'court'
  assert.throws(() => otp.otpCodeFor('x'))
  process.env.PLANNING_LINK_SECRET = 'a'.repeat(32)
})
t('verifyOtp : bon / mauvais / format invalide', () => {
  const c = otp.otpCodeFor('cmd1')
  assert.equal(otp.verifyOtp('cmd1', c), true)
  assert.equal(otp.verifyOtp('cmd1', String((Number(c) + 1) % 10000).padStart(4, '0')), false)
  assert.equal(otp.verifyOtp('cmd2', c) && otp.otpCodeFor('cmd2') !== c, false)
  for (const bad of ['', '123', '12345', 'abcd', ' 1234', '12 4', null, undefined, 1234]) assert.equal(otp.verifyOtp('cmd1', bad), false)
  assert.equal(otp.OTP_MAX_ATTEMPTS, 5)
})

// ── ETA ──
const MIN = 60_000, T0 = Date.parse('2026-10-06T10:00:00Z')
// livraison : assignée à T0+i*1000, livrée 60 min plus tard (hub H1, créneau S) ; H2 : 120 min
const mk = (id, hub, slot, durMin, startMin = 0) => ({ id, hubCode: hub, slot, at: { ASSIGNED: T0 + startMin * MIN, IN_TRANSPORT: T0 + (startMin + durMin / 3) * MIN, START_DELIVERY: T0 + (startMin + durMin * 0.7) * MIN }, deliveredAt: T0 + (startMin + durMin) * MIN })
const h1 = Array.from({ length: 5 }, (_, i) => mk('a' + i, 'H1', 'S', 60))
const h2 = Array.from({ length: 4 }, (_, i) => mk('b' + i, 'H2', 'S', 120))
const pool = [...h1, ...h2]
const NOW = T0 + 5 * MIN
const ord = (o = {}) => ({ id: 'x', status: 'ASSIGNED', hubCode: 'H1', slot: 'S', stageAt: T0, slotEnd: T0 + 600 * MIN, ...o })

t('predictEtaFrom : médiane hub×créneau', () => {
  const r = eta.predictEtaFrom(ord(), pool, NOW)
  assert.equal(Date.parse(r.etaAt), T0 + 60 * MIN)
  assert.match(r.basis, /médiane hub×créneau sur 5 livraisons/)
})
t('predictEtaFrom : repli médiane du créneau si hub trop pauvre', () => {
  const r = eta.predictEtaFrom(ord({ hubCode: 'H9' }), pool, NOW)
  assert.equal(r.source, 'slot'); assert.match(r.basis, /créneau \(tous hubs\) sur 9/)
  assert.equal(Date.parse(r.etaAt), T0 + 60 * MIN) // médiane de 5x60 et 4x120 = 60
})
t('predictEtaFrom : repli sur la fin du créneau promis', () => {
  const r = eta.predictEtaFrom(ord({ slot: 'Z' }), pool, NOW)
  assert.equal(r.source, 'promise'); assert.equal(Date.parse(r.etaAt), T0 + 600 * MIN); assert.match(r.basis, /créneau promis/)
})
t('predictEtaFrom : jamais dans le passé (>= maintenant + 5 min)', () => {
  const late = T0 + 500 * MIN
  const r = eta.predictEtaFrom(ord(), pool, late)
  assert.equal(Date.parse(r.etaAt), late + 5 * MIN)
  const r2 = eta.predictEtaFrom(ord({ slot: 'Z', slotEnd: T0 }), pool, late)
  assert.equal(Date.parse(r2.etaAt), late + 5 * MIN)
})
t('predictEtaFrom : terminée / annulée => null', () => {
  for (const s of ['DELIVERED', 'NO_SHOW', 'CANCELLED']) assert.equal(eta.predictEtaFrom(ord({ status: s }), pool, NOW).etaAt, null)
})
t('predictEtaFrom : étape courante plus avancée => durée restante plus courte', () => {
  const r = eta.predictEtaFrom(ord({ status: 'START_DELIVERY', stageAt: T0 + 42 * MIN }), pool, NOW)
  assert.equal(Date.parse(r.etaAt), T0 + 42 * MIN + 18 * MIN)
})
t('median', () => { assert.equal(eta.median([3, 1, 2]), 2); assert.equal(eta.median([1, 2, 3, 4]), 2.5); assert.equal(eta.median([]), null) })

t('etaAccuracy : insuffisant sous 20 échantillons', () => {
  const r = eta.computeEtaAccuracy(pool)
  assert.equal(r.insufficient, true); assert.equal(r.mae, null)
})
t('etaAccuracy : leave-one-out sur jeu fixe', () => {
  // 24 livraisons H1/S : 20 de 60 min, 4 de 80 min (+20 d'écart). Sans la commande évaluée la médiane reste 60.
  const set = [...Array.from({ length: 20 }, (_, i) => mk('p' + i, 'H1', 'S', 60, i * 3)), ...Array.from({ length: 4 }, (_, i) => mk('q' + i, 'H1', 'S', 80, 100 + i))]
  const r = eta.computeEtaAccuracy(set)
  assert.equal(r.insufficient, false); assert.equal(r.samples, 24)
  assert.equal(r.mae, 3.3) // 4 erreurs de 20 min / 24
  assert.equal(r.withinTolerancePct, 83.3) // 20/24 <= 15 min
  // leave-one-out : une seule livraison hors-norme ne peut pas se « prédire elle-même »
  const solo = [...Array.from({ length: 22 }, (_, i) => mk('s' + i, 'H1', 'S', 60, i)), mk('out', 'H1', 'S', 300, 50)]
  const r2 = eta.computeEtaAccuracy(solo)
  assert.equal(r2.mae, Math.round((240 / 23) * 10) / 10)
})

// ── CSAT / NPS-like / couverture ──
t('computeCsat', () => {
  const c = kpis.computeCsat([5, 5, 4, 3, 1, 2], 12)
  assert.equal(c.count, 6); assert.equal(c.average, 3.33); assert.equal(c.responseRate, 50)
  assert.deepEqual(c.distribution, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2 })
  assert.equal(c.nps, 16.7) // 3/6 = 50 % moins 2/6 = 33,3 %
  const none = kpis.computeCsat([], 10)
  assert.equal(none.average, null); assert.equal(none.nps, null); assert.equal(none.responseRate, 0)
  assert.equal(kpis.computeCsat([], 0).responseRate, null)
  assert.equal(kpis.computeCsat([0, 6, 2.5, 4], 4).count, 1) // notes hors 1-5 ignorées
})
t('computeOtpCoverage', () => {
  assert.equal(kpis.computeOtpCoverage(8, 6).value, 75)
  assert.equal(kpis.computeOtpCoverage(0, 0).value, null)
})

console.log(`\n${n} tests OK`)
