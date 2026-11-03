// Tests du compte livreur — node scripts/test-driver-account.mjs
import assert from 'node:assert/strict'
import { lib } from './_ts-alias.mjs'

const acc = await lib('ops-driver-account.ts')

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name) }

ok('mot de passe généré : 8 caractères lisibles, sans caractères ambigus, différents à chaque appel', () => {
  const a = acc.generateDriverPassword(), b = acc.generateDriverPassword()
  assert.match(a, /^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
  assert.notEqual(a, b)
  assert.ok(acc.validDriverPassword(a))
})
ok('règle de mot de passe : 6 à 72 caractères', () => {
  assert.equal(acc.validDriverPassword('abc12'), false)
  assert.equal(acc.validDriverPassword('abc123'), true)
  assert.equal(acc.validDriverPassword('x'.repeat(73)), false)
  assert.equal(acc.validDriverPassword(123456), false)
})
ok('identifiant : espaces retirés, taille bornée, non-texte ignoré', () => {
  assert.equal(acc.normalizeLogin('  D 01 '), 'D01')
  assert.equal(acc.normalizeLogin('06 12 34 56 78'), '0612345678')
  assert.equal(acc.normalizeLogin(null), '')
  assert.equal(acc.normalizeLogin('x'.repeat(100)).length, 40)
})
console.log(`\n${n} tests OK`)
