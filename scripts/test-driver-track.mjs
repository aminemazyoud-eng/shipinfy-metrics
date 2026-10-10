// Tests purs « Track & Trace » de l'application livreur (aucune base, aucun serveur) :
//   node --no-warnings --experimental-transform-types scripts/test-driver-track.mjs
import assert from 'node:assert/strict'

process.env.PLANNING_LINK_SECRET = 'a'.repeat(32)
const { lib } = await import('./_ts-alias.mjs')
const { registerHooks } = await import('node:module')
registerHooks({ resolve(spec, ctx, next) { return next(spec === 'next/server' ? 'next/server.js' : spec, ctx) } })
const geo = await lib('geo.ts')
const act = await lib('ops-driver-actions.ts')
const off = await lib('driver-offline.ts')
const cfg = await lib('ops-config.ts')
const rs = await lib('ops-reasons.ts')
const { FR, AR } = await lib('driver-i18n.ts')

let n = 0
const t = (name, fn) => { fn(); n++; console.log('  ok -', name) }
const HUB = { lat: 33.5731, lng: -7.5898 }
const near = { lat: 33.5735, lng: -7.5898 }   // ~44 m
const far = { lat: 33.58, lng: -7.5898 }       // ~ 760 m

t('config : seuils par défaut à 400 m, mode block, scan de chargement exigé', () => {
  assert.equal(cfg.DEFAULT_CFG.geofenceMeters, 400); assert.equal(cfg.DEFAULT_CFG.deliveryGeofenceMeters, 400)
  assert.equal(cfg.DEFAULT_CFG.geofenceMode, 'block'); assert.equal(cfg.DEFAULT_CFG.loadScanRequired, 1)
  assert.equal(cfg.sanitizeCfgValue('geofenceMode', 'soft'), 'soft'); assert.equal(cfg.sanitizeCfgValue('geofenceMode', 'x'), undefined)
  assert.equal(cfg.sanitizeCfgValue('loadScanRequired', 0), 0); assert.equal(cfg.sanitizeCfgValue('loadScanRequired', 2), undefined)
  assert.equal(act.driverAppConfig().geofenceMode, 'block'); assert.equal(act.driverAppConfig().loadScanRequired, true)
})
t('geoGate : block refuse hors rayon et sans GPS, soft laisse passer', () => {
  assert.equal(geo.geoGate(near, HUB, 400, 'block').pass, true)
  const f = geo.geoGate(far, HUB, 400, 'block'); assert.equal(f.pass, false); assert.equal(f.code, 'OUT_OF_RANGE'); assert.ok(f.check.distanceM > 400)
  const g = geo.geoGate(undefined, HUB, 400, 'block'); assert.equal(g.pass, false); assert.equal(g.code, 'GEO_REQUIRED')
  const s = geo.geoGate(far, HUB, 400, 'soft'); assert.equal(s.pass, true); assert.equal(s.check.ok, false)
  assert.equal(geo.geoGate(undefined, HUB, 400, 'soft').pass, true)
  assert.equal(geo.geoGate(far, { lat: null, lng: null }, 400, 'block').pass, true, 'cible sans coordonnées : rien à prouver')
})
t('shouldKeepPoint : 30 s ou 50 m', () => {
  const a = { lat: 33.5731, lng: -7.5898, at: 0 }
  assert.equal(geo.shouldKeepPoint(null, a), true)
  assert.equal(geo.shouldKeepPoint(a, { ...a, at: 10_000 }), false)
  assert.equal(geo.shouldKeepPoint(a, { ...a, at: 30_000 }), true)
  assert.equal(geo.shouldKeepPoint(a, { lat: 33.5738, lng: -7.5898, at: 5_000 }), true, '~78 m')
  assert.equal(geo.shouldKeepPoint(a, { lat: 0, lng: 0, at: 99_000 }), false, 'point nul refusé')
})
t('navLinks : Waze et Google Maps', () => {
  const l = geo.navLinks(33.5, -7.6)
  assert.equal(l.waze, 'https://waze.com/ul?ll=33.5,-7.6&navigate=yes')
  assert.equal(l.google, 'https://www.google.com/maps/dir/?api=1&destination=33.5,-7.6')
  assert.equal(geo.navLinks(null, 1), null)
})
t('arrive : action de commande, sans changement de statut, seulement en livraison', () => {
  assert.ok(act.ACTION_TYPES.includes('arrive')); assert.ok(act.isOrderAction('arrive'))
  assert.equal(act.nextStatus('arrive', 'START_DELIVERY'), 'START_DELIVERY')
  assert.equal(act.nextStatus('arrive', 'IN_TRANSPORT'), null)
  assert.equal(off.nextStatus('START_DELIVERY', 'arrive'), 'START_DELIVERY'); assert.equal(off.nextStatus('ASSIGNED', 'arrive'), null)
  assert.equal(off.nextStatus('START_DELIVERY', 'postpone'), 'START_DELIVERY')
  assert.equal(act.parseAction({ id: 'abcdefgh12', type: 'arrive', orderId: 'o1' }).action.type, 'arrive')
  assert.equal(act.parseAction({ id: 'abcdefgh12', type: 'arrive' }).error, 'orderId requis')
  assert.equal(act.parseAction({ id: 'abcdefgh12', type: 'noshow', orderId: 'o', reasonCode: 'CLIENT_ABSENT' }).action.reasonCode, 'CLIENT_ABSENT')
  assert.equal(act.parseAction({ id: 'abcdefgh12', type: 'noshow', orderId: 'o', reasonCode: 'bad code' }).action.reasonCode, undefined)
})
t('effectiveOrders : arrivée et report optimistes', () => {
  const o = { id: 'o1', ref: 'R1', status: 'START_DELIVERY', arrivedAt: null }
  const q = [{ id: 'q1', seq: 1, type: 'arrive', orderId: 'o1', at: '', tries: 0, state: 'pending' }]
  assert.equal(off.effectiveOrders([o], q)[0].arrived, true)
  assert.equal(off.effectiveOrders([o], [])[0].arrived, false)
  assert.equal(off.effectiveOrders([o], [{ ...q[0], type: 'postpone', id: 'q2' }])[0].postponed, true)
  assert.equal(off.effectiveOrders([o], [{ ...q[0], state: 'error' }])[0].arrived, false)
})
t('buildSyncBody : reasonCode transmis, report exclu', () => {
  const body = off.buildSyncBody([
    { id: 'a', seq: 1, type: 'noshow', orderId: 'o', at: 'x', reasonCode: 'CLIENT_ABSENT', tries: 0, state: 'pending' },
    { id: 'b', seq: 2, type: 'postpone', orderId: 'o2', at: 'x', tries: 0, state: 'pending' },
  ])
  assert.equal(body.actions.length, 1); assert.equal(body.actions[0].reasonCode, 'CLIENT_ABSENT')
})
t('validateNoShow : motif de la nomenclature + photo', () => {
  assert.equal(off.validateNoShow({ proofCount: 1 }), 'noshow.needReason')
  assert.equal(off.validateNoShow({ reasonCode: 'CLIENT_ABSENT', proofCount: 0 }), 'noshow.need')
  assert.equal(off.validateNoShow({ reasonCode: 'CLIENT_ABSENT', proofCount: 1 }), null)
})
t('séquence de tournée : ordre seq, reportés en fin, hors tournée après', () => {
  const mk = (id, end, extra = {}) => ({ id, ref: id, status: 'START_DELIVERY', slotEnd: new Date(Date.UTC(2026, 9, 10, end)).toISOString(), lateMin: 0, ...extra })
  const orders = [mk('a', 12), mk('b', 13), mk('c', 14), mk('d', 15, { postponed: true }), mk('x', 9)]
  const stops = [{ orderId: 'c', seq: 1 }, { orderId: 'd', seq: 2 }, { orderId: 'a', seq: 3 }, { orderId: 'b', seq: 4 }]
  const out = off.orderBySequence(orders, stops).map(r => r.order.id)
  assert.deepEqual(out, ['c', 'a', 'b', 'd', 'x'])
  assert.deepEqual(off.orderBySequence(orders, []).map(r => r.order.id), ['x', 'a', 'b', 'c', 'd'], 'repli : tri par fin de créneau')
  assert.equal(new Set(out).size, out.length)
})
t('parseTour : tolérant', () => {
  assert.deepEqual(off.parseTour(null), { tour: null, stops: [] })
  assert.deepEqual(off.parseTour({ tour: null, stops: [] }), { tour: null, stops: [] })
  assert.deepEqual(off.parseTour({ error: 'x' }), { tour: null, stops: [] })
  const ts = off.parseTour({ tour: { id: 't1', status: 'ONGOING', rotation: 1, day: '2026-10-10' }, stops: [{ orderId: 'b', seq: 2, items: [{ id: 'i', label: 'Bac', qty: 2, barcode: 'X1', loadedQty: 1 }] }, { orderId: 'a', seq: 1, canPostpone: false }, { nope: 1 }] })
  assert.equal(ts.tour.id, 't1'); assert.deepEqual(ts.stops.map(s => s.orderId), ['a', 'b']); assert.equal(ts.stops[1].items[0].loadedQty, 1); assert.equal(ts.stops[0].canPostpone, false)
})
t('chargement : reste à charger et code-barres', () => {
  assert.equal(act.remainingQty([]), 0)
  assert.equal(act.remainingQty([{ qty: 2, loadedQty: 1 }, { qty: 1, loadedQty: 1 }, { qty: 1, loadedQty: 3 }]), 1)
  assert.equal(act.normalizeBarcode(' 612345678901 '), '612345678901'); assert.equal(act.normalizeBarcode('a b'), null); assert.equal(act.normalizeBarcode(''), null); assert.equal(act.normalizeBarcode('x'.repeat(65)), null)
  assert.equal(off.cleanBarcode('BAC-001/A'), 'BAC-001/A'); assert.equal(off.cleanBarcode('<script>'), null)
})
t('compteur : bornes et cohérence départ / retour', () => {
  assert.deepEqual(act.parseKm(12345.67), { km: 12345.7 }); assert.ok(act.parseKm(-1).error); assert.ok(act.parseKm('12').error); assert.ok(act.parseKm(3_000_000).error); assert.ok(act.parseKm(NaN).error)
  assert.equal(act.kmConsistent('end', 90, { kmStart: 100, kmEnd: null }), 'KM_LOWER')
  assert.equal(act.kmConsistent('end', 100, { kmStart: 100, kmEnd: null }), null)
  assert.equal(act.kmConsistent('start', 120, { kmStart: null, kmEnd: 110 }), 'KM_HIGHER')
  assert.equal(act.kmConsistent('start', 50, { kmStart: null, kmEnd: null }), null)
})
t('motifs : liste par défaut et validation', () => {
  assert.deepEqual(rs.DEFAULT_REASONS.map(r => r.code), ['CLIENT_ABSENT', 'REFUS_PAIEMENT_COD', 'ADRESSE_ERRONEE', 'PRODUIT_ENDOMMAGE', 'CLIENT_INJOIGNABLE'])
  assert.ok(rs.DEFAULT_REASONS.every(r => r.label && r.labelAr))
  assert.equal(rs.DEFAULT_REASONS.find(r => r.code === 'REFUS_PAIEMENT_COD').cod, true)
  assert.deepEqual(off.FALLBACK_REASONS.map(r => r.code), rs.DEFAULT_REASONS.map(r => r.code), 'liste de secours = liste semée')
  assert.equal(rs.validateReasonInput({ code: 'colis refuse', label: 'Colis refusé' }).data.code, 'COLIS_REFUSE')
  assert.ok(rs.validateReasonInput({ code: '1x', label: 'x' }).error)
  assert.ok(rs.validateReasonInput({ code: 'OK_CODE', label: 'a' }).error)
  assert.ok(rs.validateReasonInput({ code: 'OK_CODE', label: 'Libellé', kind: 'AUTRE' }).error)
  assert.equal(rs.validateReasonInput({ active: false }, true).data.active, false)
  assert.equal(rs.reasonLabel({ label: 'Fr', labelAr: 'Ar' }, 'ar'), 'Ar'); assert.equal(rs.reasonLabel({ label: 'Fr', labelAr: null }, 'ar'), 'Fr')
})
t('i18n : toutes les clés présentes en FR et en AR, mêmes paramètres', () => {
  for (const k of Object.keys(FR)) assert.ok(AR[k], `AR manquant : ${k}`)
  for (const k of Object.keys(AR)) assert.ok(k in FR, `FR manquant : ${k}`)
  const params = s => (s.match(/\{(\w+)\}/g) ?? []).sort().join()
  for (const k of Object.keys(FR)) assert.equal(params(AR[k]), params(FR[k]), `paramètres différents : ${k}`)
  for (const c of off.ERROR_CODES) { const key = off.errorKey(c); assert.ok(key in FR && AR[key], key) }
  for (const c of ['OUT_OF_RANGE', 'GEO_REQUIRED', 'ARRIVE_REQUIRED', 'LOAD_INCOMPLETE', 'REASON_REQUIRED']) assert.notEqual(off.errorKey(c), 'err.UNKNOWN', c)
  assert.ok(off.RETRY_CODES.includes('OUT_OF_RANGE'))
})
console.log(`\n${n} tests OK`)
