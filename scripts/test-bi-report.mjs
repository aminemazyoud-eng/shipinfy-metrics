// Test des rapports planifiés Control Tower : périodes, sections, PDF (données synthétiques).
// Usage : node scripts/test-bi-report.mjs [--out chemin.pdf]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { lib } from './_ts-alias.mjs'

const rep = await lib('bi-report.ts')
const pdf = await lib('pdf-bi-report.ts')

// ── Périodes relatives (jour local) ──
const at = (iso) => Date.parse(iso)
assert.deepEqual(rep.periodRange('yesterday', at('2026-11-27T10:00:00Z')), { from: '2026-11-26', to: '2026-11-26' })
assert.deepEqual(rep.periodRange('last7', at('2026-11-27T10:00:00Z')), { from: '2026-11-20', to: '2026-11-26' })
assert.deepEqual(rep.periodRange('lastMonth', at('2026-11-27T10:00:00Z')), { from: '2026-10-01', to: '2026-10-31' })
assert.deepEqual(rep.periodRange('lastMonth', at('2027-01-05T10:00:00Z')), { from: '2026-12-01', to: '2026-12-31' }) // changement d'année
assert.deepEqual(rep.periodRange('last7', at('2026-11-02T23:30:00Z')).to, '2026-11-02') // 00:30 locale le 3 → « hier » = le 2
assert.ok(rep.isReportPeriod('last7') && !rep.isReportPeriod('x') && rep.isBiSection('lead') && !rep.isBiSection('kpis'))

// ── Jeu synthétique ──
let seed = 5
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const HUBS = [['Marjane Morocco Mall', 33.5746, -7.7268], ['Marjane Menara', 31.6486, -8.0877]]
const rows = []
for (let d = 0; d < 7; d++) for (let i = 0; i < 80; i++) {
  const [hub, hlat, hlng] = pick(HUBS), s0 = Date.UTC(2026, 10, 20 + d, pick([8, 11, 14, 17])), s1 = s0 + 3 * 3600000
  const cr = s0 - Math.floor(rnd() * 15 * 3600000), as = cr + 1800000, tr = as + 1800000, sd = tr + 3600000
  const delivered = rnd() < 0.85
  rows.push({ id: `T${d}-${i}`, hub, hubLat: hlat, hubLng: hlng, status: delivered ? 'DELIVERED' : 'NO_SHOW', createdAt: new Date(cr).toISOString(), assignedAt: new Date(as).toISOString(), inTransportAt: new Date(tr).toISOString(), startDeliveryAt: new Date(sd).toISOString(), deliveredAt: delivered ? new Date(sd + 2400000).toISOString() : null, slotStart: new Date(s0).toISOString(), slotEnd: new Date(s1).toISOString(), attempt: 1, amount: 100 + Math.floor(rnd() * 300), lat: hlat + (rnd() - 0.5) * 0.2, lng: hlng + (rnd() - 0.5) * 0.2, phone: '06' + String(10000000 + (i % 30) * 13), firstName: 'Client', driverId: 'D' + (i % 4), driver: 'Livreur ' + (i % 4), updatedAt: new Date(s1 + 600000).toISOString() })
}
const ALL = ['overview', 'slots', 'lead', 'drivers', 'geo', 'clients', 'value', 'quality']

// ── Rapport complet ──
const r = rep.buildBiReport(rows, ALL, { from: '2026-11-20', to: '2026-11-26' })
// La période porte sur le jour LOCAL (UTC+1) de création de la commande, pas sur le créneau
const localDay = iso => new Date(Date.parse(iso) + 3600000).toISOString().slice(0, 10)
const expected = rows.filter(x => localDay(x.createdAt) >= '2026-11-20' && localDay(x.createdAt) <= '2026-11-26').length
assert.ok(expected > 500 && expected < 560)
assert.equal(r.totalOrders, expected)
assert.deepEqual(r.sections.map(s => s.key), ALL)
assert.ok(r.sections.every(s => s.cards.length >= 4 && s.tables.length >= 1 && s.tables.every(t => t.tbl.rows.length > 0)))

// ── Sélection de sections + filtre magasin ──
const only = rep.buildBiReport(rows, ['lead'], { from: '2026-11-20', to: '2026-11-26', hub: 'Marjane Menara' })
assert.deepEqual(only.sections.map(s => s.key), ['lead'])
assert.ok(only.totalOrders > 0 && only.totalOrders < expected)
assert.ok(only.sections[0].tables[0].tbl.rows.every(row => row[0] === 'Marjane Menara' || row[0] === 'TOTAL'))

// ── Période sans commande : aucune section (l'envoi sera refusé en amont) ──
const empty = rep.buildBiReport(rows, ALL, { from: '2026-01-01', to: '2026-01-02' })
assert.equal(empty.totalOrders, 0); assert.equal(empty.sections.length, 0)

// ── Texte d'email ──
const text = rep.biReportText(r, 'Rapport test')
assert.ok(text.includes('LEAD TIMES') && text.includes('Commandes') && text.includes('PDF joint'))

// ── PDF ──
assert.equal(pdf.clean('≥ 3 h → 1 200 ’x’ ▸ −'), '>= 3 h -> 1 200 \'x\'  -')
const buf = await pdf.generateBiReportPDF(r, { title: 'Rapport test', periodText: 'Du 20/11/2026 au 26/11/2026' })
assert.equal(buf.subarray(0, 5).toString(), '%PDF-')
assert.ok(buf.length > 20_000, 'PDF trop petit : ' + buf.length)
const out = process.argv.indexOf('--out') > 0 ? process.argv[process.argv.indexOf('--out') + 1] : null
if (out) fs.writeFileSync(out, buf)
const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length
assert.ok(pages >= 8, 'une page au moins par section attendue, trouvé ' + pages)
console.log(`OK — périodes, ${r.sections.length} sections, filtre magasin, période vide, PDF ${Math.round(buf.length / 1024)} Ko / ${pages} pages`)

// ── Validation d'une planification (mêmes règles que l'API) ──
const ok = { kind: 'bi', emails: ['ops@example.com', 'chef@example.com'], sections: ['lead', 'lead', 'slots'], period: 'last7', frequency: 'weekly', time: '07:30', name: '  Suivi  ', hub: ' Marjane Menara ' }
const v = rep.validateSchedulePayload(ok)
assert.ok(v.ok); assert.equal(v.value.reportId, 'BI'); assert.equal(v.value.sections, '["lead","slots"]'); assert.equal(v.value.name, 'Suivi'); assert.equal(v.value.hub, 'Marjane Menara')
const bad = (patch, msg) => { const r2 = rep.validateSchedulePayload({ ...ok, ...patch }); assert.ok(!r2.ok, 'devrait échouer : ' + msg); assert.ok(r2.error.length > 3) }
bad({ emails: [] }, 'aucun destinataire'); bad({ emails: ['ops@example.com', 'mauvais'] }, 'email invalide'); bad({ sections: [] }, 'sections vides')
bad({ sections: ['kpis'] }, 'section inconnue'); bad({ period: 'annee' }, 'période inconnue'); bad({ time: '7h30' }, 'heure texte'); bad({ time: '25:00' }, 'heure hors plage')
bad({ frequency: 'hourly' }, 'fréquence inconnue')
assert.ok(!rep.validateSchedulePayload({ kind: 'legacy', emails: ['a@b.co'], frequency: 'daily', time: '01:40' }).ok) // legacy sans reportId
const leg = rep.validateSchedulePayload({ kind: 'legacy', reportId: 'r1', emails: ['a@b.co'], frequency: 'daily', time: '01:40' })
assert.ok(leg.ok && leg.value.kind === 'legacy' && leg.value.sections === null)
console.log('OK — validation des planifications (9 cas refusés, 2 acceptés)')
