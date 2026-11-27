// Parité du dashboard « Control Tower » : lib/ops-bi.ts contre le HTML de référence (docs/dashboard-reference).
// Le script exécute le JS du HTML dans un contexte Node avec un faux DOM, lui donne un jeu de commandes synthétique,
// puis compare cartes KPI et tableaux avec ceux calculés par lib/ops-bi.ts sur les MÊMES données.
// Usage : node scripts/test-ops-bi-parity.mjs [--html chemin] [--rows 3000]
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { projectRoot, lib } from './_ts-alias.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const htmlPath = arg('--html', path.join(projectRoot, 'docs/dashboard-reference/control-tower-reference.html'))
const N = Number(arg('--rows', 3000))
const bi = await lib('ops-bi.ts')

// ── 1. Jeu de données synthétique (reproductible) ──
let seed = 42
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const HUBS = { 'Marjane Marina': [33.6071444, -7.624387], 'Marjane Menara': [31.648657, -8.0877358], 'Marjane Massira': [31.6291789, -8.0792534], 'Marjane Agadir': [30.3940774, -9.5809294] }
const NAMES = [['Amine', 'B'], ['Karim', 'L'], ['Yassine', 'M'], ['Sara', 'T'], ['', '']]
const isoZ = ms => new Date(ms).toISOString()
const rows = []
for (let i = 0; i < N; i++) {
  const hub = pick(Object.keys(HUBS)), [hlat, hlng] = HUBS[hub]
  const day = Date.UTC(2026, 8, 1 + Math.floor(rnd() * 28))
  // créneau : majoritairement standard (08-11h UTC => 09-12h locale ...), quelques atypiques
  const base = pick([8, 11, 14, 17]) + (rnd() < 0.08 ? pick([-1, 1, 0.5]) : 0)
  const dur = rnd() < 0.06 ? pick([2, 4, 6]) : 3
  const s0 = day + base * 3600000, s1 = s0 + dur * 3600000
  const status = rnd() < 0.85 ? 'DELIVERED' : pick(['NO_SHOW', 'START_DELIVERY', 'READY_PICKUP', 'ASSIGNED'])
  const created = s0 - (rnd() < 0.1 ? -1 : 1) * Math.floor(rnd() * 20 * 3600000)
  const asg = rnd() < 0.95 ? created + Math.floor(rnd() * 3 * 3600000) : null
  const trn = asg !== null && rnd() < 0.95 ? asg + Math.floor(rnd() * 2 * 3600000) : null
  const sd = trn !== null && rnd() < 0.95 ? trn + Math.floor(rnd() * 3 * 3600000) * (rnd() < 0.02 ? -1 : 1) : null
  const dl = status === 'DELIVERED' ? (sd ?? s0) + Math.floor(rnd() * 5400000) + (rnd() < 0.3 ? 3600000 : 0) : null
  const hasGps = rnd() < 0.93, d = [hub, `Client${i % 700}`]
  const nm = pick(NAMES)
  rows.push({
    id: 'R' + i, hub, hubLat: hlat, hubLng: hlng, status,
    createdAt: rnd() < 0.01 ? null : isoZ(created), assignedAt: asg ? isoZ(asg) : null, inTransportAt: trn ? isoZ(trn) : null, startDeliveryAt: sd ? isoZ(sd) : null, deliveredAt: dl ? isoZ(dl) : null,
    slotStart: isoZ(s0), slotEnd: isoZ(s1), attempt: rnd() < 0.9 ? 1 : pick([0, 2, 3, 5]), amount: rnd() < 0.05 ? 0 : 50 + Math.floor(rnd() * 400),
    lat: hasGps ? hlat + (rnd() - 0.5) * 0.3 : null, lng: hasGps ? hlng + (rnd() - 0.5) * 0.3 : null,
    phone: rnd() < 0.04 ? '' : '06' + String(10000000 + (i * 7919) % 700 * 13).padStart(8, '0'), firstName: rnd() < 0.2 ? '' : pick(['Hamza', 'Salma', 'Omar', 'Lina']),
    driverId: nm[0] ? 'D' + NAMES.findIndex(x => x === nm) : '', driver: nm[0] ? `${nm[0]} ${nm[1]}` : null,
    updatedAt: isoZ((dl ?? s1) + Math.floor(rnd() * 7200000) - 1800000),
  })
  void d
}

// ── 2. Exécution du HTML de référence avec un faux DOM ──
const html = fs.readFileSync(htmlPath, 'utf8')
const js = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'))
const els = {}
const defaults = { tzMode: '1', grain: 'week', volumeGrain: 'day', weekdayMetric: 'total', driverView: 'driver', driverDetailMode: 'hub', valueGrain: 'week', mapMode: 'dots', start: '2026-09-01', end: '2026-09-28' }
const mkEl = id => ({ id, value: defaults[id] ?? '', innerHTML: '', textContent: '', style: {}, hidden: false, classList: { toggle() {}, contains: () => false }, dataset: {}, selectedOptions: [], options: [],
  addEventListener() {}, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 0, height: 0 }), getContext: () => null, remove() {}, prepend() {} })
const $ = id => (els[id] ??= mkEl(id))
const ctx = vm.createContext({ document: { getElementById: $, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl('x'), head: { appendChild() {} } }, window: { addEventListener() {}, devicePixelRatio: 1 }, console, Intl, Date, Math, JSON, Map, Set, URL, Blob: class {}, setTimeout, clearTimeout, alert() {}, URLSearchParams })
vm.runInContext(js, ctx)

const toHtmlRaw = r => ({
  shipperReference: r.id, dateTimeWhenOrderSent: r.createdAt ?? '', dateTimeWhenAssigned: r.assignedAt ?? '', dateTimeWhenInTransport: r.inTransportAt ?? '', dateTimeWhenStartDelivery: r.startDeliveryAt ?? '', dateTimeWhenDelivrered: r.deliveredAt ?? '',
  deliveryTimeStart: r.slotStart, deliveryTimeEnd: r.slotEnd, deliveryAttemptCount: String(r.attempt), shippingWorkflowStatus: r.status, paymentOnDeliveryAmount: String(r.amount), 'originHub.name': r.hub,
  'destinationShippingAddress.longitude': r.lng ?? '', 'destinationShippingAddress.lattitude': r.lat ?? '', 'destinationContactDetails.mobileNumber': r.phone ?? '', 'destinationContactDetails.firstname': r.firstName ?? '',
  'sprint.businessUser.firstName': r.driver ? r.driver.split(' ')[0] : '', 'sprint.businessUser.lastName': r.driver ? r.driver.split(' ')[1] : '', 'sprint.businessUser.id': r.driverId, dateTimeLastUpdate: r.updatedAt,
})
vm.runInContext('globalThis.__load = (list) => { rows.clear(); for (const raw of list) { const r = prepV3(raw); rows.set(r.id, r) } }', ctx)
ctx.__load(rows.map(toHtmlRaw))
vm.runInContext(`globalThis.__run = () => { const a = filtered(); overview(a); slotsPage(a); leadPage(a); driversPage(a); geoPage(a); clientsPage(a); valuePage(a); qualityPage(a); }`, ctx)
// le HTML lit ses menus de magasin via keepHub (innerHTML) : on laisse tous les menus à « Tous »
ctx.__run()

const text = s => s.replace(/<[^>]+>/g, '|').replace(/&amp;/g, '&').replace(/ | /g, ' ').split('|').map(x => x.trim()).filter(Boolean)
const norm = s => String(s).replace(/[  ]/g, ' ').trim()
const htmlCards = id => { const parts = [...els[id].innerHTML.matchAll(/<div class="metric"><span>(.*?)<\/span><strong>(.*?)<\/strong><small>(.*?)<\/small><\/div>/g)]; return parts.map(m => [norm(m[1]), norm(m[2]), norm(m[3])]) }
// Différences VOLONTAIRES et purement cosmétiques : entités HTML, bouton « + » de la colonne Max, noms de colonnes CSV remplacés par les champs API.
const COLMAP = { dateTimeWhenOrderSent: 'createdAt', dateTimeWhenAssigned: 'assignedAt', dateTimeWhenInTransport: 'inTransportAt', dateTimeWhenStartDelivery: 'startDeliveryAt', dateTimeWhenDelivrered: 'deliveredAt' }
const clean = s => { let t = s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/▸\s*/, ''); for (const [k, v] of Object.entries(COLMAP)) t = t.replace(k, v); return norm(t).replace(/(min)\s\+$/, '$1').replace('Max · détail', 'Max') }
const htmlTable = id => [...els[id].innerHTML.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map(c => clean(c[1])))
void text

// ── 3. Mêmes données côté lib/ops-bi.ts ──
const lp = bi.makeLocal('1')
const all = rows.map(r => bi.prepBi(r, lp))
const sel = { ...bi.DEFAULT_SEL, start: '2026-09-01', end: '2026-09-28', grain: 'week', volumeGrain: 'day', weekdayMetric: 'total', valueGrain: 'week' }
const a = all.filter(r => (!sel.start || r.day >= sel.start) && (!sel.end || r.day <= sel.end))

let checks = 0, fails = 0
const eq = (name, got, exp) => { checks++; try { assert.deepEqual(got, exp) } catch (e) { fails++; console.error('✗', name); console.error('  lib :', JSON.stringify(got).slice(0, 600)); console.error('  html:', JSON.stringify(exp).slice(0, 600)) } }
const cards = c => c.map(x => [norm(x.label), norm(x.value), norm(x.note)])
const tbl = t => [t.head.map(norm), ...t.rows.map(r => r.map(norm))]

const ov = bi.overviewData(a, sel, lp), sl = bi.slotsData(a, sel), ld = bi.leadData(a, sel), dr = bi.driversData(a, sel), ge = bi.geoData(a, sel), cl = bi.clientsData(a, sel), va = bi.valueData(a, sel), qu = bi.qualityData(a, { name: 'test', lastSync: null })

// cartes KPI
const stripSrc = c => c.map(x => [x[0], x[1], x[2]])
const ovC = htmlCards('metrics'); eq('KPI Vue générale', cards(ov.metrics).map(c => [c[0], c[1]]), ovC.map(c => [c[0], c[1]])) // les notes de libellé ont été reformulées (plus de nom de colonne CSV)
eq('KPI Créneaux', cards(sl.metrics), htmlCards('slotMetrics'))
eq('KPI Lead Times', cards(ld.metrics), htmlCards('leadMetrics'))
eq('KPI Livreurs', cards(dr.metrics), htmlCards('driverMetrics'))
eq('KPI Géographie', cards(ge.metrics), htmlCards('geoMetrics'))
eq('KPI Clients', cards(cl.metrics), htmlCards('clientMetrics'))
eq('KPI Valeur', cards(va.metrics).map(c => [c[0], c[1]]), htmlCards('valueMetrics').map(c => [c[0], c[1]]))
eq('KPI Qualité (commandes/atypiques)', [cards(qu.metrics)[1], cards(qu.metrics)[2]], [htmlCards('qualityMetrics')[1], htmlCards('qualityMetrics')[2]])

// tableaux
eq('Pivot magasin × période', tbl(ov.pivot), htmlTable('pivot'))
eq('Jours de semaine', tbl(ov.weekday.table), htmlTable('weekdayTable'))
eq('Heures de transmission', tbl(ov.prepHour.table), htmlTable('prepHourTable'))
eq('Créneaux × magasin', tbl(sl.slotTable), htmlTable('slotTable'))
eq('Paliers de retard', tbl(sl.lateTable), htmlTable('lateTable'))
eq('Statut × tentatives', tbl(sl.attemptTable), htmlTable('attemptTable'))
eq('Détail par magasin', tbl(sl.slotHubDetail), htmlTable('slotHubDetail'))
eq('Paliers × magasin', tbl(sl.lateCross), htmlTable('lateCross'))
eq('Retards × tentatives', tbl(sl.attemptLateTable), htmlTable('attemptLateTable'))
eq('Lead par magasin', tbl(ld.leadTable), htmlTable('leadTable'))
eq('Distribution des délais', tbl(ld.leadDist), htmlTable('leadDist'))
eq('Anticipation', tbl(ld.anticipationTable), htmlTable('anticipationTable'))
eq('Lead × créneau', tbl(ld.leadSlots), htmlTable('leadSlots'))
eq('Distances par palier', tbl(ge.distanceTable), htmlTable('distanceTable'))
eq('Distances par magasin', tbl(ge.distanceHub), htmlTable('distanceHub'))
eq('Fréquence clients', tbl(cl.clientTable), htmlTable('clientTable'))
eq('Récurrence × magasin', tbl(cl.clientCross), htmlTable('clientCross'))
eq('Valeur par magasin', tbl(va.hubTable), htmlTable('valueHubTable'))
eq('Valeur par créneau', tbl(va.slotTable), htmlTable('valueSlotTable'))
eq('TCD valeur', tbl(va.pivot), htmlTable('valuePivot'))
eq('Qualité', tbl(qu.table), htmlTable('qualityTable'))
eq('Livreurs · détail', tbl(dr.detail), htmlTable('driverDetail'))

// ligne à ligne : créneau, ponctualité, lead, distance
const byId = new Map([...vm.runInContext('rows', ctx)])
let rowFails = 0
for (const r of all) {
  const h = byId.get(r.id)
  const ok = h && h.slot === r.slot && h.punctual === r.punctual && h.day === r.day && h.overdue === r.overdue && (h.late ?? null) === (r.late ?? null) &&
    JSON.stringify(h.lead) === JSON.stringify(r.lead) && Math.abs((h.dist ?? -1) - (r.dist ?? -1)) < 1e-9 && (h.anticipation ?? null) === (r.anticipation ?? null) && h.customer === r.customer && h.driver === r.driver
  if (!ok) { rowFails++; if (rowFails <= 3) console.error('✗ ligne', r.id, JSON.stringify({ lib: { slot: r.slot, p: r.punctual, day: r.day, lead: r.lead, dist: r.dist }, html: h && { slot: h.slot, p: h.punctual, day: h.day, lead: h.lead, dist: h.dist } })) }
}
checks++; if (rowFails) { fails++; console.error('✗', rowFails, 'lignes divergent sur', all.length) }

console.log(`${checks - fails}/${checks} contrôles de parité OK (${all.length} commandes, ${a.length} dans la période)`)
if (fails) process.exit(1)
