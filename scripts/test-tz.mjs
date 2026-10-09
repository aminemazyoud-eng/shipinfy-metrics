// Test du fuseau Africa/Casablanca réel (Sprint 17 B6) — node scripts/test-tz.mjs
// Le Maroc est à UTC+1 toute l'année SAUF pendant le Ramadan (UTC+0). Dates 2027 vérifiées via Intl (voir plus bas).
import assert from 'node:assert/strict'
import { lib } from './_ts-alias.mjs'

const tz = await lib('tz.ts')
const slots = await lib('ops-slots.ts')
const time = await lib('ops-time.ts')
const H = 3_600_000
let n = 0
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name) }
const utc = (iso) => Date.parse(iso)

ok('2026-10-06 (hors Ramadan) : décalage +1 h', () => {
  assert.equal(tz.offsetMs(utc('2026-10-06T12:00:00Z')), H)
})
ok('2027-02-20 (Ramadan) : décalage 0', () => {
  assert.equal(tz.offsetMs(utc('2027-02-20T12:00:00Z')), 0)
})
ok('2027-03-20 (après Ramadan) : décalage +1 h', () => {
  assert.equal(tz.offsetMs(utc('2027-03-20T12:00:00Z')), H)
})

ok('dayStartUtc : 00:00 locale = 23:00Z la veille hors Ramadan, 00:00Z en Ramadan', () => {
  assert.equal(new Date(tz.dayStartUtc('2026-10-06')).toISOString(), '2026-10-05T23:00:00.000Z')
  assert.equal(new Date(tz.dayStartUtc('2027-02-20')).toISOString(), '2027-02-20T00:00:00.000Z')
  assert.equal(new Date(tz.dayStartUtc('2027-03-20')).toISOString(), '2027-03-19T23:00:00.000Z')
})

ok('dayBoundsTz cohérent : [début, fin[ contigus, 24 h hors bascule', () => {
  const b = tz.dayBoundsTz('2026-10-06'), c = tz.dayBoundsTz('2026-10-07')
  assert.equal(b.to.getTime(), c.from.getTime())
  assert.equal(b.to.getTime() - b.from.getTime(), 24 * H)
  assert.equal(tz.localDay(b.from.getTime()), '2026-10-06')
  assert.equal(tz.localDay(b.to.getTime() - 1), '2026-10-06')
  assert.equal(tz.localDay(b.to.getTime()), '2026-10-07')
  // même chose en plein Ramadan
  const r = tz.dayBoundsTz('2027-02-20')
  assert.equal(tz.localDay(r.from.getTime()), '2027-02-20')
  assert.equal(tz.localDay(r.to.getTime() - 1), '2027-02-20')
  assert.equal(tz.localDay(r.to.getTime()), '2027-02-21')
})

ok('bascule : les jours de début / fin de Ramadan durent 23 h ou 25 h et restent contigus', () => {
  // on balaie février–mars 2027 : chaque jour = [dayStart, dayStart(j+1)[ ; somme = durée totale, sans trou
  let d = '2027-01-25', prevEnd = tz.dayStartUtc(d)
  for (let i = 0; i < 70; i++) {
    const { from, to } = tz.dayBoundsTz(d)
    assert.equal(from.getTime(), prevEnd, 'trou avant ' + d)
    const len = (to.getTime() - from.getTime()) / H
    assert.ok([23, 24, 25].includes(len), `durée ${len} h pour ${d}`)
    assert.equal(tz.localDay(from.getTime()), d)
    prevEnd = to.getTime(); d = tz.addDays(d, 1)
  }
})

ok('00:30 locale en Ramadan = 00:30Z → localDay donne bien le jour local', () => {
  assert.equal(tz.localDay(utc('2027-02-20T00:30:00Z')), '2027-02-20') // avec +1 h fixe on aurait obtenu le 20 aussi, mais 23:30Z la veille :
  assert.equal(tz.localDay(utc('2027-02-19T23:30:00Z')), '2027-02-19') // +1 h fixe aurait donné le 20 (faux)
})

ok('hors Ramadan : 23:30Z la veille = 00:30 locale du lendemain', () => {
  assert.equal(tz.localDay(utc('2026-10-05T23:30:00Z')), '2026-10-06')
  const p = tz.localParts(utc('2026-10-05T23:30:00Z'))
  assert.equal(p.hour, 0); assert.equal(p.minute, 30)
})

ok('weekday / dayOfTz / attendanceKey', () => {
  assert.equal(tz.localParts(utc('2026-10-06T12:00:00Z')).weekday, 2) // mardi
  assert.equal(tz.dayOfTz('tomorrow', utc('2026-10-06T12:00:00Z')), '2026-10-07')
  assert.equal(tz.dayOfTz('-1', utc('2026-10-06T12:00:00Z')), '2026-10-05')
  assert.equal(tz.attendanceKeyTz('2026-10-06').toISOString(), '2026-10-06T00:00:00.000Z')
})

ok('canonicalSlot d’une commande à 10:30 locale en Ramadan (10:30Z) → 09-12 (équidistant 9 h / 12 h, 1er créneau)', () => {
  assert.equal(slots.canonicalSlot(utc('2027-02-20T10:30:00Z')), '09-12')
  // hors Ramadan, 10:30 locale = 09:30Z → même résultat : le créneau ne dépend pas de la période
  assert.equal(slots.canonicalSlot(utc('2026-10-06T09:30:00Z')), '09-12')
  // l'ancien calcul (+1 h fixe) aurait classé 10:30Z (Ramadan) à 11:30 → '12-15' : régression évitée
  assert.notEqual(slots.canonicalSlot(utc('2027-02-20T10:30:00Z')), '12-15')
})

ok('ops-time (enveloppes) : mêmes résultats que lib/tz', () => {
  assert.equal(time.localToday(utc('2027-02-20T12:00:00Z')), '2027-02-20')
  assert.equal(time.dayOf('2027-02-20'), '2027-02-20')
  assert.equal(time.dayBounds('2027-02-20').from.toISOString(), '2027-02-20T00:00:00.000Z')
  assert.equal(time.attendanceKey('2027-02-20').toISOString(), '2027-02-20T00:00:00.000Z')
})

console.log(`\ntest-tz : ${n} groupes de tests OK`)
