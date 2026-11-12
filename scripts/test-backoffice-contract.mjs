#!/usr/bin/env node
/**
 * Test de contrat — API exposée par le back-office Shipinfy ORIGINAL, consommée par Shipinfy Metrics.
 * Référence : docs/api/shipinfy-backoffice.openapi.yaml (partie A) et API_CONTRAT_BACKOFFICE.md.
 *
 *   node scripts/test-backoffice-contract.mjs --url http://localhost:4010 --key dev-key [--write] [--limit 5]
 *   node scripts/test-backoffice-contract.mjs --self-test      (serveur de référence en mémoire intégré)
 *
 * Sans dépendance (fetch natif, Node >= 20). Code retour 0 = contrat respecté, 1 = au moins un échec.
 * --write : exécute aussi POST /assign et POST /status (MODIFIE des commandes de la cible : à réserver aux environnements de test).
 */
import http from 'node:http'

const STATUSES = ['READY_PICKUP', 'ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY', 'DELIVERED', 'NO_SHOW', 'CANCELLED']
const RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]))
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/
const isoOk = v => typeof v === 'string' && ISO_UTC.test(v) && !Number.isNaN(Date.parse(v))

// ───────────────────────── serveur de référence en mémoire (--self-test) ─────────────────────────
function referenceServer(apiKey) {
  const HUBS = [
    { code: 'H-A', name: 'Hub A', city: 'CASABLANCA', lat: 33.57, lng: -7.58 },
    { code: 'H-B', name: 'Hub B', city: 'MARRAKECH', lat: 31.63, lng: -8.0 },
  ]
  const COURIERS = [
    { code: 'D01', firstName: 'Test', lastName: 'Un', phone: '0600000001', hubCode: 'H-A', city: 'CASABLANCA', vehicle: { plate: '1-A-6', type: 'moto' } },
    { code: 'D02', firstName: 'Test', lastName: 'Deux', hubCode: 'H-B', city: 'MARRAKECH', vehicle: { type: 'utilitaire' } },
  ]
  const base = Date.parse('2026-01-10T08:00:00.000Z')
  const orders = new Map()
  for (let i = 0; i < 47; i++) {
    const hub = HUBS[i % 2], s = i % 4 === 0 ? 'READY_PICKUP' : i % 4 === 1 ? 'ASSIGNED' : i % 4 === 2 ? 'DELIVERED' : 'NO_SHOW'
    const t0 = base + Math.floor(i / 3) * 60_000 // plusieurs commandes partagent le même updatedAt : le tri secondaire par id est exercé
    const id = 'ORD-' + String(i).padStart(4, '0')
    orders.set(id, {
      id, reference: 'REF-' + i, shipper: 'Demo', hubCode: hub.code, city: hub.city, district: 'CENTRE', status: s,
      courierRef: s === 'READY_PICKUP' ? null : COURIERS[i % 2].code,
      slotStart: new Date(base + 3_600_000).toISOString(), slotEnd: new Date(base + 3 * 3_600_000).toISOString(), slotLabel: '09-11',
      amount: i % 3 === 0 ? 250 : 0, customerName: 'Client ' + i, customerPhone: '+2126000000' + String(i).padStart(2, '0'),
      address: 'Rue ' + i, lat: hub.lat + i / 1000, lng: hub.lng + i / 1000, attemptCount: 1,
      createdAt: new Date(t0 - 3_600_000).toISOString(), assignedAt: s === 'READY_PICKUP' ? null : new Date(t0 - 1_800_000).toISOString(),
      inTransportAt: null, startDeliveryAt: null,
      deliveredAt: s === 'DELIVERED' ? new Date(t0).toISOString() : null, noShowAt: s === 'NO_SHOW' ? new Date(t0).toISOString() : null,
      updatedAt: new Date(t0).toISOString(),
    })
  }
  let tick = Date.now() // updatedAt des écritures : strictement croissant (monotone)
  const bump = o => { tick = Math.max(tick + 1, Date.now()); o.updatedAt = new Date(tick).toISOString() }
  const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  const readBody = req => new Promise(r => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { try { r(b ? JSON.parse(b) : {}) } catch { r(null) } }) })
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), p = url.pathname, q = url.searchParams
    if (p === '/health') return send(res, 200, { ok: true, serverTime: new Date().toISOString() })
    if (req.headers['x-api-key'] !== apiKey) return send(res, 401, { error: 'invalid api key' })
    if (req.method === 'GET' && p === '/api/v1/hubs') return send(res, 200, { data: HUBS })
    if (req.method === 'GET' && p === '/api/v1/couriers') return send(res, 200, { data: COURIERS })
    if (req.method === 'GET' && p === '/api/v1/orders') {
      const limit = Math.min(Math.max(Number(q.get('limit')) || 1000, 1), 5000)
      const cursor = q.get('cursor'), [cIso, cId = ''] = cursor ? cursor.split('|') : ['', '']
      const list = [...orders.values()]
        .filter(o => (!q.get('hub') || o.hubCode === q.get('hub')) && (!q.get('status') || o.status === q.get('status')) && (!q.get('city') || o.city === q.get('city').toUpperCase()))
        .filter(o => !cIso || o.updatedAt > cIso || (o.updatedAt === cIso && o.id > cId))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id < b.id ? -1 : 1))
      const data = list.slice(0, limit), last = data[data.length - 1]
      return send(res, 200, { data, hasMore: list.length > limit, nextCursor: last ? `${last.updatedAt}|${last.id}` : cursor || null, serverTime: new Date().toISOString() })
    }
    const m = p.match(/^\/api\/v1\/orders\/([^/]+)(?:\/(assign|status))?$/)
    if (m) {
      const o = orders.get(decodeURIComponent(m[1]))
      if (!o) return send(res, 404, { error: 'not found' })
      if (req.method === 'GET' && !m[2]) return send(res, 200, o)
      if (req.method === 'POST' && m[2]) {
        const b = await readBody(req)
        if (!b) return send(res, 400, { error: 'JSON invalide' })
        if (m[2] === 'assign') {
          if (b.courierRef !== null && !COURIERS.some(c => c.code === b.courierRef)) return send(res, 422, { error: 'courierRef inconnu' })
          if (o.courierRef !== b.courierRef) { // idempotent : rejouer la même affectation ne change rien (updatedAt inclus)
            o.courierRef = b.courierRef
            if (b.courierRef && o.status === 'READY_PICKUP') { o.status = 'ASSIGNED'; o.assignedAt = new Date().toISOString() }
            bump(o)
          }
          return send(res, 200, { ok: true, order: o })
        }
        if (!(b.status in RANK)) return send(res, 422, { error: 'statut inconnu' })
        if (o.status === b.status) return send(res, 200, { ok: true, order: o }) // rejeu : sans effet
        if (RANK[b.status] < RANK[o.status]) return send(res, 409, { error: 'rétrogradation refusée' })
        o.status = b.status; const at = new Date().toISOString()
        if (b.status === 'IN_TRANSPORT') o.inTransportAt = at
        if (b.status === 'START_DELIVERY') o.startDeliveryAt = at
        if (b.status === 'DELIVERED') o.deliveredAt = at
        if (b.status === 'NO_SHOW') o.noShowAt = at
        bump(o); return send(res, 200, { ok: true, order: o })
      }
    }
    return send(res, 404, { error: 'route inconnue' })
  })
}

// ───────────────────────────────────────── exécuteur ─────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = n => argv.includes('--' + n)
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }

let pass = 0, fail = 0, warns = 0
async function check(name, fn) {
  try { await fn(); pass++; console.log(`  ok      ${name}`) } catch (e) { fail++; console.log(`  ECHEC   ${name}\n          -> ${e.message}`) }
}
const warn = msg => { warns++; console.log(`  avert.  ${msg}`) }
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

async function main() {
  let server = null, URL_ = opt('url', 'http://localhost:4010').replace(/\/$/, ''), KEY = opt('key', 'dev-key')
  const WRITE = flag('write') || flag('self-test')
  if (flag('self-test')) {
    KEY = 'dev-key'
    server = referenceServer(KEY)
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    URL_ = `http://127.0.0.1:${server.address().port}`
    console.log(`Self-test : serveur de référence en mémoire sur ${URL_}`)
  }
  console.log(`Cible : ${URL_}  (écriture ${WRITE ? 'ACTIVE' : 'désactivée'})\n`)
  const call = async (method, path, { key = KEY, body } = {}) => {
    const r = await fetch(URL_ + path, { method, headers: { ...(key ? { 'x-api-key': key } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
    let json = null; try { json = await r.json() } catch { /* corps non JSON */ }
    return { status: r.status, json }
  }
  const ordersUrl = (qs = {}) => '/api/v1/orders?' + new URLSearchParams(qs)

  console.log('Sécurité et santé')
  await check('401 sans clé x-api-key', async () => { must((await call('GET', '/api/v1/orders', { key: null })).status === 401, 'attendu 401') })
  await check('401 avec une mauvaise clé', async () => { must((await call('GET', '/api/v1/hubs', { key: 'mauvaise-cle' })).status === 401, 'attendu 401') })
  await check('GET /health : 200, ok=true, serverTime ISO UTC', async () => {
    const r = await call('GET', '/health', { key: null }); must(r.status === 200, `HTTP ${r.status}`)
    must(r.json?.ok === true, 'ok doit valoir true'); must(isoOk(r.json?.serverTime), 'serverTime ISO 8601 UTC (suffixe Z) attendu')
  })

  console.log('\nRéférentiels')
  let hubs = [], couriers = []
  await check('GET /api/v1/hubs : { data: Hub[] } (code, name, city, lat, lng)', async () => {
    const r = await call('GET', '/api/v1/hubs'); must(r.status === 200 && Array.isArray(r.json?.data) && r.json.data.length > 0, 'data[] non vide attendu')
    hubs = r.json.data
    for (const h of hubs) {
      must(typeof h.code === 'string' && h.code && typeof h.name === 'string' && typeof h.city === 'string', `hub invalide : ${JSON.stringify(h)}`)
      must(typeof h.lat === 'number' && typeof h.lng === 'number' && Math.abs(h.lat) <= 90 && Math.abs(h.lng) <= 180, `lat/lng invalides : ${h.code}`)
    }
    must(new Set(hubs.map(h => h.code)).size === hubs.length, 'codes de hub non uniques')
  })
  await check('GET /api/v1/couriers : { data: Courier[] } (code, firstName, lastName, hubCode, vehicle.type)', async () => {
    const r = await call('GET', '/api/v1/couriers'); must(r.status === 200 && Array.isArray(r.json?.data) && r.json.data.length > 0, 'data[] non vide attendu')
    couriers = r.json.data
    for (const c of couriers) must(['code', 'firstName', 'lastName', 'hubCode'].every(k => typeof c[k] === 'string' && c[k]), `livreur invalide : ${JSON.stringify(c)}`)
    must(new Set(couriers.map(c => c.code)).size === couriers.length, 'codes livreur non uniques')
    if (couriers.some(c => c.vehicle?.type == null)) warn('couriers : vehicle.type absent pour certains livreurs (recommandé : coût / capacité)')
    const hc = new Set(hubs.map(h => h.code)); if (couriers.some(c => !hc.has(c.hubCode))) warn('couriers : hubCode inconnu dans /hubs')
  })

  console.log('\nCommandes : forme')
  const first = await call('GET', ordersUrl({ limit: '1000' }))
  let all = [], allComplete = false
  await check('GET /api/v1/orders : enveloppe { data, hasMore, nextCursor, serverTime }', async () => {
    must(first.status === 200, `HTTP ${first.status}`); const b = first.json
    must(Array.isArray(b?.data), 'data[] attendu'); must(typeof b.hasMore === 'boolean', 'hasMore booléen attendu')
    must(b.nextCursor === null || typeof b.nextCursor === 'string', 'nextCursor string|null attendu'); must(isoOk(b.serverTime), 'serverTime ISO UTC attendu')
    all = b.data; allComplete = !b.hasMore
    must(all.length > 0, 'aucune commande : impossible de tester la suite (injecter des commandes de test)')
  })
  await check('commandes : champs obligatoires, énumérations et formats', async () => {
    for (const o of all) {
      must(typeof o.id === 'string' && o.id.trim(), 'id manquant')
      must(STATUSES.includes(o.status), `${o.id} : statut hors énumération (${o.status})`)
      for (const f of ['slotStart', 'slotEnd', 'updatedAt']) must(isoOk(o[f]), `${o.id} : ${f} ISO 8601 UTC (suffixe Z) obligatoire`)
      must(Date.parse(o.slotStart) < Date.parse(o.slotEnd), `${o.id} : slotStart doit précéder slotEnd`)
      for (const f of ['createdAt', 'assignedAt', 'inTransportAt', 'startDeliveryAt', 'deliveredAt', 'noShowAt']) must(o[f] == null || isoOk(o[f]), `${o.id} : ${f} doit être null ou ISO UTC`)
      must(o.amount == null || (typeof o.amount === 'number' && o.amount >= 0), `${o.id} : amount numérique >= 0 ou null`)
      must((o.lat == null) === (o.lng == null), `${o.id} : lat et lng vont ensemble`)
      must(o.lat == null || (Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180), `${o.id} : lat/lng hors bornes`)
      if (o.status === 'DELIVERED') must(o.deliveredAt, `${o.id} : DELIVERED sans deliveredAt`)
      if (o.status === 'NO_SHOW') must(o.noShowAt, `${o.id} : NO_SHOW sans noShowAt`)
    }
    must(new Set(all.map(o => o.id)).size === all.length, 'ids dupliqués dans une même page')
  })
  await check('commandes : champs recommandés (avertissements)', async () => {
    const n = k => all.filter(o => o[k] == null || o[k] === '').length
    const rule = (k, why) => { if (n(k)) warn(`${n(k)}/${all.length} commandes sans ${k} (${why})`) }
    rule('hubCode', 'filtres et capacité par hub'); rule('customerPhone', 'suivi client, OTP, WhatsApp'); rule('lat', 'secteurs, géofence, carte')
    rule('createdAt', 'historique et délais'); rule('address', 'tournées et preuves')
    const noCourier = all.filter(o => RANK[o.status] >= 1 && RANK[o.status] <= 4 && !o.courierRef).length
    if (noCourier) warn(`${noCourier} commandes affectées/en cours sans courierRef`)
  })

  console.log('\nCommandes : pagination par curseur')
  let walked = []
  await check('pagination limit petit : ordre, doublons, trous, hasMore/nextCursor', async () => {
    const total = all.length; must(total >= 2, 'moins de 2 commandes : pagination non testable')
    const limit = Number(opt('limit', '0')) || Math.max(1, Math.min(5, Math.floor(total / 3)))
    let cursor = null, pages = 0, prevHasMore = true, prevKey = ''
    for (; pages < 400; ) {
      const r = await call('GET', ordersUrl({ limit: String(limit), ...(cursor ? { cursor } : {}) })); must(r.status === 200, `HTTP ${r.status} page ${pages + 1}`)
      const b = r.json; pages++; must(prevHasMore, 'page reçue alors que la précédente annonçait hasMore=false')
      must(b.data.length <= limit, `page de ${b.data.length} > limit ${limit}`)
      for (const o of b.data) {
        const key = `${o.updatedAt}|${o.id}`; must(key > prevKey, `tri non croissant (updatedAt, id) : ${prevKey} puis ${key}`); prevKey = key
        walked.push(o)
      }
      if (b.data.length) {
        const l = b.data[b.data.length - 1]; must(b.nextCursor === `${l.updatedAt}|${l.id}`, `nextCursor "${b.nextCursor}" != "<updatedAt>|<id>" du dernier élément`)
      }
      must(b.hasMore === false || b.data.length === limit, 'hasMore=true avec une page incomplète')
      prevHasMore = b.hasMore; cursor = b.nextCursor
      if (!b.hasMore) break
      must(b.nextCursor, 'hasMore=true sans nextCursor')
    }
    must(!prevHasMore, 'pagination sans fin (plus de 400 pages)')
    must(pages >= 2 || total <= limit, 'une seule page alors que total > limit')
    must(new Set(walked.map(o => o.id)).size === walked.length, 'doublon : une commande apparaît deux fois dans le parcours')
    if (allComplete) {
      const a = new Set(all.map(o => o.id)); const miss = [...a].filter(id => !walked.some(o => o.id === id))
      must(miss.length === 0, `trous : ${miss.length} commande(s) absentes du parcours paginé (ex. ${miss[0]})`)
      must(walked.length === all.length, `parcours (${walked.length}) != lecture unique (${all.length})`)
    } else warn('jeu de données > 1000 commandes : comparaison parcours / lecture unique ignorée')
    console.log(`          (${walked.length} commandes en ${pages} pages de ${limit})`)
  })
  await check('reprendre au dernier nextCursor : data vide, hasMore=false, curseur conservé', async () => {
    const last = walked[walked.length - 1]; const c = `${last.updatedAt}|${last.id}`
    const r = await call('GET', ordersUrl({ limit: '5', cursor: c })); must(r.status === 200, `HTTP ${r.status}`)
    must(r.json.data.length === 0 && r.json.hasMore === false, 'attendu data=[] et hasMore=false'); must(r.json.nextCursor === c, `nextCursor doit rester "${c}" (reçu ${r.json.nextCursor})`)
  })

  console.log('\nCommandes : filtres et lecture unitaire')
  await check('filtre hub= (et city=, status=) cohérents avec la lecture complète', async () => {
    const hub = all.find(o => o.hubCode)?.hubCode; must(hub, 'aucune commande avec hubCode')
    const r = await call('GET', ordersUrl({ hub, limit: '1000' })); must(r.status === 200, `HTTP ${r.status}`)
    must(r.json.data.length > 0 && r.json.data.every(o => o.hubCode === hub), 'hub= renvoie des commandes d\'un autre hub')
    if (allComplete) must(r.json.data.length === all.filter(o => o.hubCode === hub).length, 'hub= : effectif différent du filtrage local')
    const st = all[0].status; const r2 = await call('GET', ordersUrl({ status: st, limit: '1000' }))
    must(r2.json.data.length > 0 && r2.json.data.every(o => o.status === st), 'status= renvoie un autre statut')
    const city = all.find(o => o.city)?.city
    if (city) { const r3 = await call('GET', ordersUrl({ city, limit: '1000' })); must(r3.json.data.length > 0 && r3.json.data.every(o => String(o.city).toUpperCase() === city.toUpperCase()), 'city= renvoie une autre ville') } else warn('aucune commande avec city : filtre city= non testé')
  })
  await check('filtre + curseur combinés : le curseur s\'applique après le filtre', async () => {
    const hub = all.find(o => o.hubCode)?.hubCode; const a = await call('GET', ordersUrl({ hub, limit: '2' }))
    if (!a.json.hasMore) return
    const b = await call('GET', ordersUrl({ hub, limit: '2', cursor: a.json.nextCursor }))
    must(b.json.data.every(o => o.hubCode === hub), 'filtre perdu à la page 2')
    must(!b.json.data.some(o => a.json.data.some(x => x.id === o.id)), 'doublon entre pages filtrées')
  })
  await check('GET /api/v1/orders/{id} : 200 et même id ; 404 si inconnu', async () => {
    const o = all[0]; const r = await call('GET', `/api/v1/orders/${encodeURIComponent(o.id)}`); must(r.status === 200 && r.json?.id === o.id, `HTTP ${r.status}`)
    must((await call('GET', '/api/v1/orders/__inconnu__')).status === 404, 'attendu 404')
  })

  console.log('\nÉcritures retour (Metrics -> back-office)')
  if (!WRITE) console.log('  (ignorées : relancer avec --write sur un environnement de TEST)')
  else {
    const cand = all.find(o => o.status === 'READY_PICKUP') || all.find(o => o.status === 'ASSIGNED')
    if (!cand) warn('aucune commande READY_PICKUP/ASSIGNED : écritures non testées')
    else {
      const id = encodeURIComponent(cand.id), courier = couriers[0].code
      const get = async () => (await call('GET', `/api/v1/orders/${id}`)).json
      await check('POST /assign {courierRef} : 2xx, rejouable, effet visible', async () => {
        const r1 = await call('POST', `/api/v1/orders/${id}/assign`, { body: { courierRef: courier } }); must(r1.status >= 200 && r1.status < 300, `HTTP ${r1.status}`)
        const o1 = await get(); must(o1.courierRef === courier, `courierRef ${o1.courierRef} != ${courier}`); must(RANK[o1.status] >= 1, 'statut devrait être au moins ASSIGNED')
        const r2 = await call('POST', `/api/v1/orders/${id}/assign`, { body: { courierRef: courier } }); must(r2.status >= 200 && r2.status < 300, `rejeu : HTTP ${r2.status}`)
        const o2 = await get(); must(o2.courierRef === courier && o2.updatedAt === o1.updatedAt, 'rejeu idempotent : l\'état (updatedAt inclus) ne doit pas changer')
      })
      await check('POST /assign : 404 si commande inconnue', async () => { must((await call('POST', '/api/v1/orders/__inconnu__/assign', { body: { courierRef: courier } })).status === 404, 'attendu 404') })
      await check('POST /status {status} : 2xx, rejouable, updatedAt monotone', async () => {
        const before = await get(); const target = before.status === 'IN_TRANSPORT' ? 'START_DELIVERY' : 'IN_TRANSPORT'
        const r1 = await call('POST', `/api/v1/orders/${id}/status`, { body: { status: target } }); must(r1.status >= 200 && r1.status < 300, `HTTP ${r1.status}`)
        const o1 = await get(); must(o1.status === target, `statut ${o1.status} != ${target}`); must(Date.parse(o1.updatedAt) >= Date.parse(before.updatedAt), 'updatedAt a reculé')
        const r2 = await call('POST', `/api/v1/orders/${id}/status`, { body: { status: target } }); must(r2.status >= 200 && r2.status < 300, `rejeu : HTTP ${r2.status}`)
        const o2 = await get(); must(o2.status === target && o2.updatedAt === o1.updatedAt, 'rejeu idempotent : état inchangé')
      })
      await check('POST /status : statut inconnu -> 4xx ; commande inconnue -> 404', async () => {
        const r = await call('POST', `/api/v1/orders/${id}/status`, { body: { status: 'N_IMPORTE_QUOI' } }); must(r.status >= 400 && r.status < 500, `attendu 4xx, reçu ${r.status}`)
        must((await call('POST', '/api/v1/orders/__inconnu__/status', { body: { status: 'IN_TRANSPORT' } })).status === 404, 'attendu 404')
      })
    }
  }

  console.log(`\nRésultat : ${pass} ok, ${fail} échec(s), ${warns} avertissement(s)`)
  process.exitCode = fail ? 1 : 0
  if (server) { server.closeAllConnections?.(); await new Promise(r => server.close(r)) }
}

main().catch(e => { console.error('Erreur fatale :', e.message); process.exitCode = 2 })
