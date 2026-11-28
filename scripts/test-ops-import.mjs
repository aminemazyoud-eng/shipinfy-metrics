// Test du scénario B (import d'un fichier d'export) : lecture CSV -> commandes -> mêmes chiffres que le Dashboard pour l'API.
// Usage : node scripts/test-ops-import.mjs
import assert from 'node:assert/strict'
import { lib } from './_ts-alias.mjs'

const imp = await lib('ops-import.ts')
const bi = await lib('ops-bi.ts')
const csv = await lib('csv-parse.ts')

const q = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const toCsv = (rows, cols = imp.EXPORT_COLUMNS) => '﻿' + cols.join(',') + '\r\n' + rows.map(r => cols.map(c => q(r[c])).join(',')).join('\r\n') + '\r\n'
const parse = text => { const t = csv.parseCsv(text), head = t[0].map(h => h.trim()); return t.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === '' || r[i] === undefined ? null : r[i]]))) }

// ── Jeu synthétique (même génération que le test de parité) ──
let seed = 11
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const HUBS = { 'Marjane Marina': [33.6071444, -7.624387], 'Marjane Menara': [31.648657, -8.0877358], 'Marjane Agadir': [30.3940774, -9.5809294] }
const iso = ms => new Date(ms).toISOString().replace('Z', '+0000')
const src = []
for (let i = 0; i < 1500; i++) {
  const hub = pick(Object.keys(HUBS)), [hlat, hlng] = HUBS[hub], day = Date.UTC(2026, 10, 1 + Math.floor(rnd() * 25)), s0 = day + pick([8, 11, 14, 17]) * 3600000, s1 = s0 + 3 * 3600000
  const cr = s0 - Math.floor(rnd() * 15 * 3600000), as = cr + 1800000, tr = as + 1800000, sd = tr + 3600000, delivered = rnd() < 0.85
  const dl = delivered ? sd + Math.floor(rnd() * 5400000) : null, gps = rnd() < 0.93, drv = pick([['Amine', 'B', 'D1'], ['Karim', 'L', 'D2'], ['', '', '']])
  src.push({
    shipperReference: 'R' + i, dateTimeWhenOrderSent: iso(cr), dateTimeWhenAssigned: iso(as), dateTimeWhenInTransport: iso(tr), dateTimeWhenStartDelivery: iso(sd), dateTimeWhenDelivrered: dl ? iso(dl) : '',
    deliveryTimeStart: iso(s0), deliveryTimeEnd: iso(s1), deliveryAttemptCount: rnd() < 0.9 ? 1 : 2, shippingWorkflowStatus: delivered ? 'DELIVERED' : pick(['NO_SHOW', 'START_DELIVERY']),
    paymentOnDeliveryAmount: 100 + Math.floor(rnd() * 300), 'originHub.name': hub, 'originHub.address.longitude': hlng, 'originHub.address.lattitude': hlat,
    'destinationShippingAddress.longitude': gps ? hlng + (rnd() - 0.5) * 0.3 : '', 'destinationShippingAddress.lattitude': gps ? hlat + (rnd() - 0.5) * 0.3 : '',
    'destinationContactDetails.mobileNumber': '06' + String(10000000 + (i % 200) * 13), 'destinationContactDetails.firstname': pick(['Hamza', 'Salma, B.']),
    'sprint.businessUser.firstName': drv[0], 'sprint.businessUser.lastName': drv[1], 'sprint.businessUser.id': drv[2], dateTimeLastUpdate: iso((dl ?? s1) + 600000),
  })
}
// l'export contient des lignes en double : on ajoute, pour chaque 5e commande, une ancienne version (mise à jour plus ancienne, autre statut)
const dups = src.filter((_, i) => i % 5 === 0).map(r => ({ ...r, shippingWorkflowStatus: 'START_DELIVERY', dateTimeWhenDelivrered: '', dateTimeLastUpdate: iso(Date.parse(r.dateTimeLastUpdate.replace('+0000', 'Z')) - 7200000) }))
const text = toCsv([...dups, ...src]) // les doublons anciens AVANT les versions récentes, puis l'inverse
const text2 = toCsv([...src, ...dups])

// ── 1. Cartographie ──
const m = imp.mapExportRows(parse(text))
assert.deepEqual(m.missingColumns, [])
assert.equal(m.rows, 1500 + dups.length); assert.equal(m.unique, 1500); assert.equal(m.duplicates, dups.length); assert.equal(m.rejected.length, 0)
assert.deepEqual(imp.mapExportRows(parse(text2)).orders.map(o => o.status).sort(), m.orders.map(o => o.status).sort(), 'l\'ordre des lignes ne doit pas changer le résultat')
assert.equal(m.statuses.DELIVERED, src.filter(r => r.shippingWorkflowStatus === 'DELIVERED').length, 'la version la plus récente de chaque commande est gardée')
assert.deepEqual(m.unknownStatuses, [])
assert.equal(m.hubs.length, 3); assert.ok(m.hubs.every(h => h.code.startsWith('IMP:') && h.lat && h.lng))
assert.deepEqual(m.period && Object.keys(m.period), ['from', 'to'])

// ── 2. Mêmes chiffres que le Dashboard alimenté par l'API ──
// reconstruction d'un BiRaw comme le fait lib/ops-bi-data.ts depuis les tables, puis comparaison avec le calcul sur les lignes sources
const hubBy = new Map(m.hubs.map(h => [h.code, h]))
const asBiRaw = o => { const h = hubBy.get(o.hubCode), d = x => (x ? x.toISOString() : null); return { id: o.externalId, hub: h.name, hubLat: h.lat, hubLng: h.lng, status: o.status, createdAt: d(o.createdAtSrc), assignedAt: d(o.assignedAt), inTransportAt: d(o.inTransportAt), startDeliveryAt: d(o.startDeliveryAt), deliveredAt: d(o.deliveredAt), slotStart: d(o.slotStart), slotEnd: d(o.slotEnd), attempt: o.attemptCount, amount: o.amount, lat: o.lat, lng: o.lng, phone: o.customerPhone, firstName: o.customerName?.split(' ')[0] ?? null, driverId: o.courierRef, driver: o.courierRef, updatedAt: d(o.sourceUpdatedAt) } }
const direct = src.map(r => ({ id: r.shipperReference, hub: r['originHub.name'], hubLat: r['originHub.address.lattitude'], hubLng: r['originHub.address.longitude'], status: r.shippingWorkflowStatus, createdAt: new Date(r.dateTimeWhenOrderSent.replace('+0000', 'Z')).toISOString(), assignedAt: new Date(r.dateTimeWhenAssigned.replace('+0000', 'Z')).toISOString(), inTransportAt: new Date(r.dateTimeWhenInTransport.replace('+0000', 'Z')).toISOString(), startDeliveryAt: new Date(r.dateTimeWhenStartDelivery.replace('+0000', 'Z')).toISOString(), deliveredAt: r.dateTimeWhenDelivrered ? new Date(r.dateTimeWhenDelivrered.replace('+0000', 'Z')).toISOString() : null, slotStart: new Date(r.deliveryTimeStart.replace('+0000', 'Z')).toISOString(), slotEnd: new Date(r.deliveryTimeEnd.replace('+0000', 'Z')).toISOString(), attempt: r.deliveryAttemptCount, amount: r.paymentOnDeliveryAmount, lat: r['destinationShippingAddress.lattitude'] === '' ? null : r['destinationShippingAddress.lattitude'], lng: r['destinationShippingAddress.longitude'] === '' ? null : r['destinationShippingAddress.longitude'], phone: r['destinationContactDetails.mobileNumber'], firstName: r['destinationContactDetails.firstname'].split(' ')[0], driverId: r['sprint.businessUser.id'] || null, driver: `${r['sprint.businessUser.firstName']} ${r['sprint.businessUser.lastName']}`.trim() || null, updatedAt: new Date(r.dateTimeLastUpdate.replace('+0000', 'Z')).toISOString() }))
const lp = bi.makeLocal('1')
const A = direct.map(r => bi.prepBi(r, lp)).sort((a, b) => a.id.localeCompare(b.id))
const B = m.orders.map(asBiRaw).map(r => bi.prepBi(r, lp)).sort((a, b) => a.id.localeCompare(b.id))
assert.equal(A.length, B.length)
let diff = 0
A.forEach((a, i) => { const b = B[i]; if (!(a.id === b.id && a.day === b.day && a.slot === b.slot && a.punctual === b.punctual && a.overdue === b.overdue && a.status === b.status && a.amount === b.amount && a.attempt === b.attempt && JSON.stringify(a.lead) === JSON.stringify(b.lead) && Math.abs((a.dist ?? -1) - (b.dist ?? -1)) < 1e-9 && a.customer === b.customer && a.firstname === b.firstname)) diff++ })
assert.equal(diff, 0, diff + ' commandes différent entre le calcul « fichier » et le calcul « API »')
const sel = { ...bi.DEFAULT_SEL, start: '2026-11-01', end: '2026-11-30' }
assert.deepEqual(bi.slotsData(A, sel).metrics, bi.slotsData(B, sel).metrics, 'cartes Créneaux identiques')
assert.deepEqual(bi.leadData(A, sel).metrics, bi.leadData(B, sel).metrics, 'cartes Lead Times identiques')
assert.deepEqual(bi.overviewData(A, sel, lp).metrics, bi.overviewData(B, sel, lp).metrics, 'cartes Vue générale identiques')

// ── 3. Cas limites ──
const base = src[0]
const edge = imp.mapExportRows(parse(toCsv([
  { ...base, shipperReference: 'OK1', shippingWorkflowStatus: 'canceled' },
  { ...base, shipperReference: '' },
  { ...base, shipperReference: 'BADSLOT', deliveryTimeEnd: 'pas-une-date' },
  { ...base, shipperReference: 'REVERSED', deliveryTimeStart: base.deliveryTimeEnd, deliveryTimeEnd: base.deliveryTimeStart },
  { ...base, shipperReference: 'NOSTATUS', shippingWorkflowStatus: '' },
  { ...base, shipperReference: 'ODD', shippingWorkflowStatus: 'ACCEPT_IN_VEHICLE', paymentOnDeliveryAmount: '123,5', 'destinationShippingAddress.longitude': 0, 'destinationShippingAddress.lattitude': 0, deliveryAttemptCount: '' },
])))
assert.deepEqual(edge.rejected.map(r => r.reference), [null, 'BADSLOT', 'REVERSED', 'NOSTATUS'])
const ok1 = edge.orders.find(o => o.externalId === 'OK1'); assert.equal(ok1.status, 'CANCELLED')
const odd = edge.orders.find(o => o.externalId === 'ODD')
assert.equal(odd.amount, 123.5); assert.equal(odd.lat, null); assert.equal(odd.attemptCount, 1); assert.deepEqual(edge.unknownStatuses, ['ACCEPT_IN_VEHICLE'])
// colonnes obligatoires manquantes
const miss = imp.mapExportRows(parse(toCsv(src.slice(0, 3), imp.EXPORT_COLUMNS.filter(c => c !== 'deliveryTimeEnd' && c !== 'originHub.name'))))
assert.deepEqual(miss.missingColumns.sort(), ['deliveryTimeEnd', 'originHub.name']); assert.equal(miss.orders.length, 0)
assert.equal(imp.mapExportRows([]).orders.length, 0)
// alias d'orthographe (latitude / Delivered) et BOM sur le 1er en-tête
const alt = imp.mapExportRows([{ '﻿shipperReference': 'A1', dateTimeWhenOrderSent: base.dateTimeWhenOrderSent, deliveryTimeStart: base.deliveryTimeStart, deliveryTimeEnd: base.deliveryTimeEnd, shippingWorkflowStatus: 'DELIVERED', 'originHub.name': 'Marjane Marina', 'originHub.address.latitude': 33.6, 'originHub.address.longitude': -7.6, dateTimeWhenDelivered: base.deliveryTimeEnd }])
assert.equal(alt.orders.length, 1); assert.ok(alt.orders[0].deliveredAt); assert.equal(alt.hubs[0].lat, 33.6)
assert.equal(imp.hubSlug('Marjane Hay Hassani'), 'marjane-hay-hassani'); assert.equal(imp.hubSlug('Marjane Hé  Ñ'), 'marjane-he-n')
// modèle téléchargeable : se relit lui-même
const tpl = imp.mapExportRows(parse(imp.templateCsv()))
assert.equal(tpl.orders.length, 1); assert.equal(tpl.rejected.length, 0); assert.deepEqual(tpl.missingColumns, [])
console.log(`OK — import par fichier : ${m.rows} lignes -> ${m.unique} commandes (${m.duplicates} doublons), 0 écart avec le calcul API, cas limites et modèle`)

// ── Mise à jour incrémentale (envoi automatique toutes les 5 min) ──
const D = s => new Date(s)
const mk = (id, over = {}) => ({ externalId: id, hubCode: 'IMP:x', status: 'START_DELIVERY', slotStart: D('2026-11-20T08:00:00Z'), slotEnd: D('2026-11-20T11:00:00Z'), createdAtSrc: D('2026-11-20T07:00:00Z'), assignedAt: D('2026-11-20T07:30:00Z'), inTransportAt: null, startDeliveryAt: null, deliveredAt: null, noShowAt: null, attemptCount: 1, amount: 100, lat: null, lng: null, customerName: null, customerPhone: null, courierRef: 'Amine B', sourceUpdatedAt: D('2026-11-20T08:00:00Z'), ...over })
const ex = o => ({ externalId: o.externalId, status: o.status, sourceUpdatedAt: o.sourceUpdatedAt, courierRef: o.courierRef, attemptCount: o.attemptCount, amount: o.amount, assignedAt: o.assignedAt, inTransportAt: o.inTransportAt, startDeliveryAt: o.startDeliveryAt, deliveredAt: o.deliveredAt })
const stored = [mk('A'), mk('B'), mk('C'), mk('D'), mk('E')]
const incoming = [
  mk('A'),                                                                                   // identique -> inchangée
  mk('B', { status: 'DELIVERED', deliveredAt: D('2026-11-20T09:00:00Z'), sourceUpdatedAt: D('2026-11-20T09:00:00Z') }), // livrée -> à mettre à jour
  mk('C', { courierRef: 'Karim L' }),                                                       // changement de livreur SANS horodatage plus récent -> détecté
  mk('D', { sourceUpdatedAt: D('2026-11-20T07:00:00Z') }),                                  // version PLUS ANCIENNE, contenu identique -> inchangée (jamais de retour en arrière)
  mk('F'),                                                                                  // nouvelle
]
const df = imp.diffImport(stored.map(ex), incoming)
assert.deepEqual(df.toInsert.map(o => o.externalId), ['F'])
assert.deepEqual(df.toReplace.map(o => o.externalId), ['B', 'C'])
assert.equal(df.unchanged, 2)
// un export COMPLET renvoyé à l'identique toutes les 5 min : aucune écriture
const again = imp.diffImport(stored.map(ex), stored)
assert.deepEqual([again.toInsert.length, again.toReplace.length, again.unchanged], [0, 0, 5])
console.log('OK — import incrémental : nouvelles / modifiées / inchangées, export complet répété sans écriture')
