'use strict'
/**
 * MOCK BACK-OFFICE Shipinfy / E-Delivery  —  environnement de test indépendant de l'app.
 *
 * Rôle : simuler l'API que le vrai back-office exposera un jour. L'app Shipinfy Opérationnel
 * l'interroge toutes les 5 min (sync incrémentale `updatedSince`). Le jour où l'API réelle existe,
 * on change seulement BACKOFFICE_API_URL + BACKOFFICE_API_KEY : le contrat reste identique.
 *
 * Source : data3.xlsx (4 304 commandes Marjane, mars 2026) re-datée autour d'AUJOURD'HUI :
 *   - dernier jour complet du fichier  -> DEMAIN  (précommandes qui arrivent au fil de la journée)
 *   - avant-dernier                    -> AUJOURD'HUI (cycle de vie simulé en direct)
 *   - jours précédents                 -> historique J-1, J-2…
 * Le statut d'une commande est une fonction pure de l'horloge (réelle + décalage) : aucun timer,
 * donc la donnée « vit » toute seule et on peut voyager dans le temps via /admin/clock.
 *
 * Lancer :  node mock-backoffice/server.js     (port 4010, clé x-api-key = dev-key)
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
let XLSX
try { XLSX = require('xlsx') } catch { XLSX = require('../node_modules/xlsx') }
const { HUBS, buildDrivers } = require('./org')

const PORT = Number(process.env.MOCK_PORT) || 4010
const API_KEY = process.env.MOCK_API_KEY || 'dev-key'
const XLSX_FILE = process.env.MOCK_XLSX || path.join(__dirname, 'data', 'data3.xlsx')
const STATE_FILE = path.join(__dirname, 'data', 'state.json')
const TZ_MS = 60 * 60 * 1000 // Africa/Casablanca (UTC+1)
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// ── utilitaires ─────────────────────────────────────────────────────────────
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function rngFor(id) {
  let a = hash(String(id))
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const between = (r, a, b) => a + r() * (b - a)
const localDayIdx = ms => Math.floor((ms + TZ_MS) / DAY)
const localDayStart = idx => idx * DAY - TZ_MS // ms UTC du minuit local
const parseTs = v => { if (!v) return null; const t = Date.parse(String(v).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')); return Number.isNaN(t) ? null : t }
const iso = ms => new Date(ms).toISOString()
const pad2 = n => String(n).padStart(2, '0')
const slotLabel = ms => pad2(new Date(ms + TZ_MS).getUTCHours())

function distKm(aLat, aLng, bLat, bLng) {
  const x = (aLng - bLng) * Math.cos(((aLat + bLat) / 2) * Math.PI / 180)
  const y = aLat - bLat
  return Math.sqrt(x * x + y * y) * 111
}
function nearestHub(lat, lng) {
  const pool = lat < 32.5 ? (lat < 31.0 ? HUBS.filter(h => h.city === 'AGADIR') : HUBS.filter(h => h.city === 'MARRAKECH')) : HUBS.filter(h => h.city === 'CASABLANCA')
  let best = pool[0], bd = Infinity
  for (const h of pool) { const d = distKm(lat, lng, h.lat, h.lng); if (d < bd) { bd = d; best = h } }
  return best
}

const DRIVERS = buildDrivers()
const DRIVERS_BY_HUB = {}
for (const d of DRIVERS) (DRIVERS_BY_HUB[d.hubCode] ||= []).push(d)

// ── état persistant (horloge + overrides + commandes injectées) ─────────────
let state = { clockOffsetMs: 0, overrides: {}, injected: [] }
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } } catch { /* premier lancement */ }
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)) } catch (e) { console.warn('[mock] state non sauvegardé', e.message) } }
const now = () => Date.now() + state.clockOffsetMs

// ── chargement + re-datation de data3.xlsx ──────────────────────────────────
function loadBase() {
  console.log('[mock] lecture', XLSX_FILE)
  const wb = XLSX.readFile(XLSX_FILE)
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
  // L'export contient des doublons (même id répété : 4 304 lignes -> 2 591 expéditions) : on garde la ligne la plus récente.
  const latest = new Map()
  for (const r of rawRows) {
    const k = String(r.id ?? r.externalReference); const p = latest.get(k)
    if (!p || (parseTs(r.dateTimeLastUpdate) ?? 0) >= (parseTs(p.dateTimeLastUpdate) ?? 0)) latest.set(k, r)
  }
  const rows = [...latest.values()]
  console.log(`[mock] ${rawRows.length} lignes -> ${rows.length} expéditions uniques`)

  const perDay = {}
  for (const r of rows) { const s = parseTs(r.deliveryTimeStart); if (s) { const d = localDayIdx(s); perDay[d] = (perDay[d] || 0) + 1 } }
  const validDays = Object.keys(perDay).map(Number).filter(d => perDay[d] >= 25).sort((a, b) => a - b)
  if (validDays.length < 3) throw new Error('data3.xlsx : pas assez de jours exploitables')

  const todayIdx = localDayIdx(Date.now())
  const dayShift = {}
  validDays.slice().reverse().forEach((d, i) => { dayShift[d] = (todayIdx + 1 - i) - d }) // dernier -> demain, avant-dernier -> aujourd'hui…

  const out = []
  for (const r of rows) {
    const S0 = parseTs(r.deliveryTimeStart), E0 = parseTs(r.deliveryTimeEnd)
    if (!S0 || !E0) continue
    const od = localDayIdx(S0)
    if (!(od in dayShift)) continue
    const sh = dayShift[od] * DAY
    const lat = Number(r['destinationShippingAddress.lattitude']), lng = Number(r['destinationShippingAddress.longitude'])
    if (!lat || !lng) continue
    const id = String(r.id ?? r.externalReference)
    const rand = rngFor(id)
    const S = S0 + sh, E = E0 + sh
    const o = (v) => { const t = parseTs(v); return t ? t + sh : null }

    // arrivée de la commande : lead réel si plausible, sinon 1–22 h avant le créneau
    let C = o(r.dateTimeWhenOrderSent)
    if (!C || S - C < 30 * MIN || S - C > 36 * HOUR) C = S - between(rand, 1 * HOUR, 22 * HOUR)

    const origStatus = r.shippingWorkflowStatus
    let A = o(r.dateTimeWhenAssigned), T = o(r.dateTimeWhenInTransport), SD = o(r.dateTimeWhenStartDelivery), D = o(r.dateTimeWhenDelivrered)
    let N = o(r.dateTimeWhenNoShow)
    let outcome = origStatus === 'DELIVERED' ? 'DELIVERED' : origStatus === 'NO_SHOW' ? 'NO_SHOW' : (rand() < 0.95 ? 'DELIVERED' : 'NO_SHOW')
    const synthetic = origStatus === 'READY_PICKUP'

    A = Math.max(A ?? S - between(rand, 45 * MIN, 120 * MIN), C + 3 * MIN)
    T = Math.max(T ?? A + between(rand, 1 * MIN, 8 * MIN), A + 1 * MIN)
    SD = Math.max(SD ?? S + between(rand, -25 * MIN, 15 * MIN), T + 2 * MIN)
    const end = outcome === 'DELIVERED'
      ? (D ?? S + between(rand, -5 * MIN, (E - S) + 25 * MIN))
      : (N ?? SD + between(rand, 10 * MIN, 60 * MIN))
    const finish = Math.max(end, SD + 4 * MIN)

    out.push(finalize({
      id, reference: String(r.reference ?? r.carrierReference ?? id), externalReference: String(r.externalReference ?? id),
      shipper: 'Marjane', city: lat < 32.5 ? 'MARRAKECH' : 'CASABLANCA',
      district: String(r['destinationDistrict.name'] ?? r['destinationCity.name'] ?? '').toUpperCase() || null,
      lat, lng, address: r['destinationShippingAddress.address'] ?? null,
      customer: [r['destinationContactDetails.firstname'], String(r['destinationContactDetails.lastname'] ?? '').slice(0, 1) + '.'].filter(Boolean).join(' '),
      amount: Number(r.paymentOnDeliveryAmount) || 0, cluster: r.sprintCluster ?? null,
      S, E, C, A, T, SD, outcome, finish, attempts: Number(r.deliveryAttemptCount) || 1, synthetic,
    }))

    // clone synthétique vers Agadir (~6 %) pour avoir un 3e hub/ville alimenté
    if (hash(id) % 16 === 0) {
      const r2 = rngFor(id + '-aga')
      const aga = HUBS.find(h => h.city === 'AGADIR')
      const k = out[out.length - 1]
      out.push(finalize({
        ...k.raw, id: id + '-AGA', reference: k.raw.reference + '-AGA', externalReference: k.raw.externalReference + '-AGA',
        city: 'AGADIR', district: 'AGADIR', lat: aga.lat + between(r2, -0.05, 0.05), lng: aga.lng + between(r2, -0.06, 0.06),
        address: 'Agadir (adresse fictive)', cluster: null,
      }))
    }
  }
  return out
}

function finalize(raw) {
  const hub = nearestHub(raw.lat, raw.lng)
  return { raw, hub, hubCode: hub.code, hubName: hub.name }
}

let BASE = loadBase()
const ALL = () => BASE.concat(state.injected.map(finalize))

// ── vue d'une commande à l'instant `t` ──────────────────────────────────────
function view(order, t) {
  const r = order.raw
  const ov = state.overrides[r.id] || {}
  if (r.C > t) return null // pas encore arrivée
  const delay = (ov.delayMin || 0) * MIN
  const S = ov.slotStart ?? r.S, E = ov.slotEnd ?? (ov.slotStart ? ov.slotStart + (r.E - r.S) : r.E)
  const A = r.A, T = r.T, SD = r.SD + delay, F = r.finish + delay

  let status
  if (t < A) status = 'READY_PICKUP'
  else if (t < T) status = 'ASSIGNED'
  else if (t < SD) status = 'IN_TRANSPORT'
  else if (t < F) status = 'START_DELIVERY'
  else status = r.outcome
  let updatedAt = Math.max(r.C, ...[A, T, SD, F].filter(x => x <= t))
  if (ov.status) { status = ov.status; updatedAt = Math.max(updatedAt, ov.at || t) }
  if (ov.at && ov.at <= t) updatedAt = Math.max(updatedAt, ov.at)

  const hubDrivers = DRIVERS_BY_HUB[order.hubCode] || []
  const assigned = status !== 'READY_PICKUP' || ov.courierRef
  const courierRef = ov.courierRef ?? (assigned && hubDrivers.length ? hubDrivers[hash(r.id) % hubDrivers.length].code : null)
  const done = status === 'DELIVERED' || status === 'NO_SHOW'
  return {
    id: r.id, reference: r.reference, externalReference: r.externalReference, shipper: r.shipper,
    hubCode: order.hubCode, hubName: order.hubName, city: order.hub.city, district: r.district,
    status, courierRef,
    slotStart: iso(S), slotEnd: iso(E), slotLabel: `${slotLabel(S)}-${slotLabel(E)}`,
    amount: r.amount, customerName: r.customer, address: r.address, lat: r.lat, lng: r.lng, cluster: r.cluster,
    attemptCount: r.attempts,
    createdAt: iso(r.C),
    assignedAt: t >= A || ov.courierRef ? iso(A) : null,
    inTransportAt: t >= T ? iso(T) : null,
    startDeliveryAt: t >= SD ? iso(SD) : null,
    deliveredAt: status === 'DELIVERED' ? iso(ov.status ? (ov.at || t) : F) : null,
    noShowAt: status === 'NO_SHOW' ? iso(ov.status ? (ov.at || t) : F) : null,
    late: done ? false : t > E,
    updatedAt: iso(updatedAt),
    synthetic: !!r.synthetic,
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
const readBody = req => new Promise(resolve => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}) } catch { resolve({}) } }) })

function dayRange(spec) {
  // 'today' | 'tomorrow' | 'yesterday' | 'YYYY-MM-DD' | entier (offset)
  const base = localDayIdx(now())
  let idx
  if (!spec || spec === 'today') idx = base
  else if (spec === 'tomorrow') idx = base + 1
  else if (spec === 'yesterday') idx = base - 1
  else if (/^\d{4}-\d\d-\d\d$/.test(spec)) idx = Math.floor(Date.parse(spec + 'T00:00:00Z') / DAY)
  else idx = base + Number(spec)
  return [localDayStart(idx), localDayStart(idx + 1)]
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname, q = url.searchParams
  if (p === '/health') return send(res, 200, { ok: true, serverTime: iso(now()), realTime: iso(Date.now()), clockOffsetMin: Math.round(state.clockOffsetMs / MIN), orders: ALL().length })
  if ((req.headers['x-api-key'] || q.get('apiKey')) !== API_KEY) return send(res, 401, { error: 'invalid api key' })
  const t = now()

  try {
    if (req.method === 'GET' && p === '/api/v1/hubs') return send(res, 200, { data: HUBS.map(({ drivers, ...h }) => h) })
    if (req.method === 'GET' && p === '/api/v1/couriers') return send(res, 200, { data: DRIVERS })

    if (req.method === 'GET' && p === '/api/v1/orders') {
      const limit = Math.min(Number(q.get('limit')) || 1000, 5000)
      const cursor = q.get('cursor') || q.get('updatedSince') // "ISO|id" ou "ISO"
      const [cIso, cId = ''] = cursor ? cursor.split('|') : ['', '']
      const hub = q.get('hub'), status = q.get('status'), city = q.get('city')
      const range = q.get('day') ? dayRange(q.get('day')) : null
      let list = []
      for (const o of ALL()) {
        if (hub && o.hubCode !== hub) continue
        if (city && o.hub.city !== city.toUpperCase()) continue
        if (range && !(o.raw.S >= range[0] && o.raw.S < range[1])) continue
        const v = view(o, t)
        if (!v) continue
        if (status && v.status !== status) continue
        if (cIso && (v.updatedAt < cIso || (v.updatedAt === cIso && v.id <= cId))) continue
        list.push(v)
      }
      list.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id < b.id ? -1 : 1))
      const page = list.slice(0, limit)
      const last = page[page.length - 1]
      return send(res, 200, { data: page, count: page.length, hasMore: list.length > limit, nextCursor: last ? `${last.updatedAt}|${last.id}` : cursor || null, serverTime: iso(t) })
    }

    let m = p.match(/^\/api\/v1\/orders\/([^/]+)$/)
    if (req.method === 'GET' && m) {
      const o = ALL().find(x => x.raw.id === decodeURIComponent(m[1])); const v = o && view(o, t)
      return v ? send(res, 200, v) : send(res, 404, { error: 'not found' })
    }
    m = p.match(/^\/api\/v1\/orders\/([^/]+)\/assign$/)
    if (req.method === 'POST' && m) { // écriture retour : dispatch depuis Shipinfy Opérationnel
      const id = decodeURIComponent(m[1]); const b = await readBody(req)
      if (!ALL().some(x => x.raw.id === id)) return send(res, 404, { error: 'not found' })
      state.overrides[id] = { ...(state.overrides[id] || {}), courierRef: b.courierRef ?? null, at: t }
      saveState(); return send(res, 200, { ok: true })
    }

    // ── admin : manipuler la donnée pour tester ────────────────────────────
    if (p === '/admin/state') return send(res, 200, { clockOffsetMin: Math.round(state.clockOffsetMs / MIN), serverTime: iso(t), overrides: Object.keys(state.overrides).length, injected: state.injected.length })

    if (req.method === 'POST' && p === '/admin/clock') { // {offsetMinutes} | {addMinutes} | {setTo:"2026-10-05T08:00:00+01:00"} | {reset:true}
      const b = await readBody(req)
      if (b.reset) state.clockOffsetMs = 0
      else if (b.setTo) state.clockOffsetMs = Date.parse(b.setTo) - Date.now()
      else if (b.addMinutes != null) state.clockOffsetMs += Number(b.addMinutes) * MIN
      else if (b.offsetMinutes != null) state.clockOffsetMs = Number(b.offsetMinutes) * MIN
      saveState(); return send(res, 200, { serverTime: iso(now()), clockOffsetMin: Math.round(state.clockOffsetMs / MIN) })
    }

    m = p.match(/^\/admin\/orders\/([^/]+)$/)
    if (req.method === 'POST' && m) { // {status, delayMinutes, courierRef, slotStart}
      const id = decodeURIComponent(m[1]); const b = await readBody(req)
      if (!ALL().some(x => x.raw.id === id)) return send(res, 404, { error: 'not found' })
      const ov = state.overrides[id] || {}
      if (b.status) ov.status = b.status
      if (b.delayMinutes != null) ov.delayMin = Number(b.delayMinutes)
      if (b.courierRef !== undefined) ov.courierRef = b.courierRef
      if (b.slotStart) ov.slotStart = Date.parse(b.slotStart)
      ov.at = t; state.overrides[id] = ov; saveState()
      return send(res, 200, { ok: true, order: view(ALL().find(x => x.raw.id === id), t) })
    }

    if (req.method === 'POST' && p === '/admin/delay') { // retarde en masse les commandes non terminées : {hubCode?, day?, minutes, pct?}
      const b = await readBody(req); const range = dayRange(b.day || 'today'); let n = 0
      for (const o of ALL()) {
        if (b.hubCode && o.hubCode !== b.hubCode) continue
        if (!(o.raw.S >= range[0] && o.raw.S < range[1])) continue
        const v = view(o, t); if (!v || v.status === 'DELIVERED' || v.status === 'NO_SHOW') continue
        if (rngFor(o.raw.id + 'dly')() > (b.pct ?? 1)) continue
        const ov = state.overrides[o.raw.id] || {}; ov.delayMin = (ov.delayMin || 0) + Number(b.minutes || 30); ov.at = t; state.overrides[o.raw.id] = ov; n++
      }
      saveState(); return send(res, 200, { delayed: n })
    }

    if (req.method === 'POST' && p === '/admin/inject') { // nouvelles commandes : {count, day, hubCode, hour, lenHours, amount}
      const b = await readBody(req); const n = Math.min(Number(b.count) || 10, 500)
      const hubs = b.hubCode ? HUBS.filter(h => h.code === b.hubCode) : HUBS
      const [d0] = dayRange(b.day || 'tomorrow'); const len = (b.lenHours || 3) * HOUR; const base = state.injected.length
      for (let i = 0; i < n; i++) {
        const id = `INJ-${Date.now().toString(36)}-${base + i}`; const r = rngFor(id)
        const hub = hubs[Math.floor(r() * hubs.length)]
        const S = d0 + (b.hour ?? 9) * HOUR; const lat = hub.lat + between(r, -0.04, 0.04), lng = hub.lng + between(r, -0.05, 0.05)
        const A = Math.max(S - between(r, 45 * MIN, 120 * MIN), t + 3 * MIN), T = A + 3 * MIN, SD = Math.max(T + 5 * MIN, S + between(r, -20 * MIN, 15 * MIN))
        state.injected.push({
          id, reference: id, externalReference: id, shipper: 'Marjane', city: hub.city, district: 'TEST', lat, lng, address: 'Commande injectée (test)',
          customer: 'Test T.', amount: b.amount ?? Math.round(between(r, 150, 1200)), cluster: null, S, E: S + len, C: t, A, T, SD,
          outcome: r() < 0.95 ? 'DELIVERED' : 'NO_SHOW', finish: SD + between(r, 10 * MIN, len + 25 * MIN), attempts: 1, synthetic: true,
        })
      }
      saveState(); return send(res, 200, { injected: n, total: state.injected.length })
    }

    if (req.method === 'POST' && p === '/admin/reset') { state = { clockOffsetMs: 0, overrides: {}, injected: [] }; saveState(); return send(res, 200, { ok: true }) }

    if (req.method === 'GET' && p === '/admin/summary') { // comptes par jour/créneau/statut (pour vérifier le test)
      const out = {}
      for (const o of ALL()) {
        const v = view(o, t); if (!v) continue
        const d = new Date(o.raw.S + TZ_MS).toISOString().slice(0, 10)
        const k = ((out[d] ||= { total: 0, byStatus: {}, byHub: {}, bySlot: {} }))
        k.total++; k.byStatus[v.status] = (k.byStatus[v.status] || 0) + 1
        k.byHub[v.hubCode] = (k.byHub[v.hubCode] || 0) + 1; k.bySlot[v.slotLabel] = (k.bySlot[v.slotLabel] || 0) + 1
      }
      return send(res, 200, out)
    }

    return send(res, 404, { error: 'route inconnue' })
  } catch (e) {
    console.error('[mock]', e); return send(res, 500, { error: String(e.message || e) })
  }
})

server.listen(PORT, () => console.log(`[mock] back-office de test sur http://localhost:${PORT}  (x-api-key: ${API_KEY}) — ${ALL().length} commandes`))
