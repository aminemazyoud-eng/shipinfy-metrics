// lib/ops-demo.ts — générateur de données de TEST (fonctions pures, AUCUN import : testable sans base, scripts/test-demo.mjs).
// Produit des commandes fictives avec une chaîne d'événements cohérente (Reçue → Assignée → Acceptée → En livraison → Livrée/NO_SHOW → Encaissée),
// déterministe pour (jour, hub, index) : relancer le seed ne change ni les identifiants ni la répartition.

export const DEMO_PREFIX = 'DEMO-'
export const DEMO_EVENT_SOURCE = 'demo'
const MIN = 60_000

export type DemoCategory = 'pend_today' | 'pend_24' | 'pend_48' | 'collected' | 'in_transport' | 'start_delivery' | 'assigned' | 'unassigned' | 'no_show' | 'cancelled'

/** Répartition par défaut (somme = 100 %). */
export const DEMO_MIX: { cat: DemoCategory; pct: number }[] = [
  { cat: 'pend_today', pct: 22 }, { cat: 'pend_24', pct: 15 }, { cat: 'pend_48', pct: 8 }, // livrées non encaissées : 45 %
  { cat: 'collected', pct: 15 },
  { cat: 'in_transport', pct: 7 }, { cat: 'start_delivery', pct: 8 }, // en cours : 15 %
  { cat: 'assigned', pct: 10 }, { cat: 'unassigned', pct: 8 },
  { cat: 'no_show', pct: 4 }, { cat: 'cancelled', pct: 3 },
]

export interface DemoSlot { label: string; startMs: number; endMs: number }
export interface DemoHubIn { code: string; city: string; lat: number | null; lng: number | null; drivers: { id: string; code: string }[] }
export interface DemoEvent { fromStatus: string | null; toStatus: string; at: Date }
export interface DemoSpec {
  category: DemoCategory
  externalId: string; reference: string; hubCode: string; city: string; district: string
  status: string; slotLabel: string; slotStart: Date; slotEnd: Date
  amount: number; customerName: string; customerPhone: string; address: string; lat: number; lng: number
  driverId: string | null; courierRef: string | null
  createdAtSrc: Date; assignedAt: Date | null; inTransportAt: Date | null; startDeliveryAt: Date | null; deliveredAt: Date | null; noShowAt: Date | null
  arrivedAt: Date | null; deliveredLat: number | null; deliveredLng: number | null
  collectedAt: Date | null; collectedAmount: number | null; collectedBy: string | null; collectionMethod: string | null
  reasonCode: string | null; cancelReason: string | null; sourceUpdatedAt: Date
  events: DemoEvent[]
  items: { sku: string; label: string; qty: number; barcode: string }[]
}
export interface DemoInput {
  day: string                 // YYYY-MM-DD (jour local)
  count: number               // total, tous hubs confondus
  nowMs: number
  hubs: DemoHubIn[]
  daySlots: DemoSlot[]        // créneaux du jour demandé
  allSlots: DemoSlot[]        // créneaux des jours récents (pour les commandes livrées il y a 1 à 4 jours)
  dayStartMs: number; dayEndMs: number
  reasonCodes: string[]
}

// ── aléatoire déterministe ────────────────────────────────────────────────────
export function hashStr(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const ri = (r: () => number, a: number, b: number) => a + Math.floor(r() * (b - a + 1))
const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)]

/** Répartit n commandes selon DEMO_MIX (plus forts restes), puis mélange de façon déterministe. */
export function splitCategories(n: number, rng: () => number): DemoCategory[] {
  const raw = DEMO_MIX.map(m => ({ cat: m.cat, exact: (n * m.pct) / 100 }))
  const out = raw.map(x => ({ cat: x.cat, k: Math.floor(x.exact), rem: x.exact - Math.floor(x.exact) }))
  let left = n - out.reduce((s, x) => s + x.k, 0)
  for (const x of [...out].sort((a, b) => b.rem - a.rem)) { if (left <= 0) break; x.k++; left-- }
  const list: DemoCategory[] = []
  for (const x of out) for (let i = 0; i < x.k; i++) list.push(x.cat)
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]] }
  return list
}

// ── données fictives ──────────────────────────────────────────────────────────
const FIRST = ['Youssef', 'Fatima', 'Mohamed', 'Khadija', 'Omar', 'Salma', 'Hamza', 'Imane', 'Ayoub', 'Sara', 'Mehdi', 'Nadia', 'Rachid', 'Houda', 'Karim', 'Zineb', 'Anas', 'Meryem', 'Yassine', 'Laila']
const LAST = ['Alaoui', 'Bennani', 'Idrissi', 'Tazi', 'Fassi', 'Chraibi', 'El Amrani', 'Berrada', 'Lahlou', 'Benjelloun', 'Ouazzani', 'Skalli', 'Zniber', 'Haddad', 'Mansouri', 'Kettani']
const STREETS = ['rue des Orangers', 'avenue des FAR', 'boulevard Zerktouni', 'rue Ibn Sina', 'rue Al Massira', 'avenue Hassan II', 'rue des Palmiers', 'rue Moulay Youssef', 'avenue Mohammed V', 'rue Oum Rabia']
const DISTRICTS: Record<string, string[]> = {
  CASABLANCA: ['Maarif', 'Anfa', 'Ain Diab', 'Californie', 'Oasis', 'Sidi Maarouf', 'Bouskoura', 'Hay Hassani', 'Roches Noires', 'Gauthier'],
  MARRAKECH: ['Gueliz', 'Hivernage', 'Palmeraie', 'Daoudiate', 'Massira', 'Targa', 'Semlalia'],
  AGADIR: ['Founty', 'Talborjt', 'Anza', 'Hay Mohammadi', 'Sonaba', 'Dakhla'],
}
const GENERIC_DISTRICTS = ['Centre-ville', 'Hay Salam', 'Hay Riad', 'Les Jardins', 'Industriel']
const CITY_CENTER: Record<string, [number, number]> = { CASABLANCA: [33.5731, -7.5898], MARRAKECH: [31.6295, -8.0089], AGADIR: [30.4278, -9.5981] }
const PRODUCTS = ['Panier fruits & légumes', 'Pack eau 6x1,5 L', 'Lait demi-écrémé x6', 'Poulet fermier', 'Pack yaourts', 'Huile d\'olive 1 L', 'Riz basmati 5 kg', 'Café moulu 500 g', 'Fromage frais', 'Pain complet']
const METHODS = ['especes', 'especes', 'especes', 'especes', 'especes', 'especes', 'especes', 'carte', 'carte', 'virement']

interface Win { slot: DemoSlot; t: number }
/** Instant aléatoire dans [lo, hi] tombant à l'intérieur d'un créneau (entre début + 40 min et fin − 5 min). null si impossible. */
function pickInWindow(rng: () => number, slots: DemoSlot[], lo: number, hi: number): Win | null {
  const c: { s: DemoSlot; a: number; b: number }[] = []
  for (const s of slots) { const a = Math.max(s.startMs + 40 * MIN, lo), b = Math.min(s.endMs - 5 * MIN, hi); if (b - a >= 10 * MIN) c.push({ s, a, b }) }
  if (!c.length) return null
  const x = c[Math.floor(rng() * c.length)]
  return { slot: x.s, t: Math.round(x.a + rng() * (x.b - x.a)) }
}
/** Dernier recours : instant libre dans la fenêtre, rattaché au dernier créneau commencé avant (ou au plus proche). */
function looseWindow(rng: () => number, slots: DemoSlot[], lo: number, hi: number): Win {
  const t = Math.round(lo + rng() * Math.max(0, hi - lo))
  const before = slots.filter(s => s.startMs <= t).sort((a, b) => b.startMs - a.startMs)[0]
  const slot = before ?? [...slots].sort((a, b) => Math.abs(a.startMs - t) - Math.abs(b.startMs - t))[0]
  return { slot, t }
}

const GAPS: [number, number][] = [[3, 20], [5, 30], [5, 30], [8, 35]] // READY→ASSIGNED, →IN_TRANSPORT, →START_DELIVERY, →final (min)
const PATH = ['READY_PICKUP', 'ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY']

/** Chaîne complète jusqu'à `final` (aucune étape sautée), construite à rebours depuis l'instant de la dernière étape. */
export function chainBackward(rng: () => number, final: string, tLast: number): DemoEvent[] {
  const steps = final === 'DELIVERED' || final === 'NO_SHOW' ? [...PATH, final] : PATH.slice(0, PATH.indexOf(final) + 1)
  const times: number[] = new Array(steps.length)
  times[steps.length - 1] = tLast
  for (let i = steps.length - 2; i >= 0; i--) { const [a, b] = GAPS[i]; times[i] = times[i + 1] - ri(rng, a, b) * MIN - ri(rng, 0, 59) * 1000 }
  return steps.map((s, i) => ({ fromStatus: i === 0 ? null : steps[i - 1], toStatus: s, at: new Date(times[i]) }))
}

/** Construit le plan complet (une spec par commande). Aucun accès base, aucun effet de bord. */
export function buildDemoPlan(inp: DemoInput): { specs: DemoSpec[]; warnings: string[] } {
  const { nowMs: N } = inp
  const warnings: string[] = []
  const hubs = inp.hubs
  const specs: DemoSpec[] = []
  if (!hubs.length || !inp.daySlots.length) return { specs, warnings: ['Aucun hub ou aucun créneau configuré'] }
  const dayKey = inp.day.replace(/-/g, '').slice(2)
  const base = Math.floor(inp.count / hubs.length), extra = inp.count % hubs.length

  hubs.forEach((hub, hi) => {
    const n = base + (hi < extra ? 1 : 0)
    const rng = mulberry32(hashStr(`${inp.day}|${hub.code}`))
    const cats = splitCategories(n, rng)
    const needsDriver = (c: DemoCategory) => c !== 'unassigned' && c !== 'cancelled'
    if (!hub.drivers.length) warnings.push(`Hub ${hub.code} : aucun livreur, commandes limitées à « non assignée »`)
    const [clat0, clng0] = CITY_CENTER[hub.city] ?? CITY_CENTER.CASABLANCA
    const clat = hub.lat ?? clat0, clng = hub.lng ?? clng0
    const districts = DISTRICTS[hub.city] ?? GENERIC_DISTRICTS

    for (let i = 0; i < n; i++) {
      const r = mulberry32(hashStr(`${inp.day}|${hub.code}|${i}`)) // flux propre à la commande : stable même si le nombre total change
      let cat = cats[i]
      if (needsDriver(cat) && !hub.drivers.length) cat = 'unassigned'
      const seq = String(i + 1).padStart(3, '0')
      const ref = `${DEMO_PREFIX}${hub.code}-${dayKey}-${seq}`
      const driver = needsDriver(cat) ? pick(r, hub.drivers) : null

      // ── horodatage de la dernière étape + créneau ───────────────────────────
      const todayLo = inp.dayStartMs, todayHi = Math.min(inp.dayEndMs, N - 5 * MIN)
      let win: Win | null = null
      let events: DemoEvent[] = []
      let finalStatus = 'READY_PICKUP'
      const done = cat === 'pend_today' || cat === 'collected' || cat === 'no_show'
      const running = cat === 'in_transport' || cat === 'start_delivery'
      if (cat === 'pend_24') win = pickInWindow(r, inp.allSlots, N - 47 * 3_600_000, N - 25 * 3_600_000) ?? looseWindow(r, inp.allSlots, N - 47 * 3_600_000, N - 25 * 3_600_000)
      else if (cat === 'pend_48') win = pickInWindow(r, inp.allSlots, N - 90 * 3_600_000, N - 49 * 3_600_000) ?? looseWindow(r, inp.allSlots, N - 90 * 3_600_000, N - 49 * 3_600_000)
      else if (done || running) {
        win = pickInWindow(r, inp.daySlots, todayLo, todayHi)
          ?? pickInWindow(r, inp.allSlots, N - 30 * 3_600_000, N - 10 * MIN)
          ?? looseWindow(r, inp.allSlots, N - 30 * 3_600_000, N - 10 * MIN)
      }

      let status: string
      let slot: DemoSlot
      if (cat === 'pend_today' || cat === 'pend_24' || cat === 'pend_48' || cat === 'collected') { status = 'DELIVERED'; slot = win!.slot; events = chainBackward(r, 'DELIVERED', win!.t) }
      else if (cat === 'no_show') { status = 'NO_SHOW'; slot = win!.slot; events = chainBackward(r, 'NO_SHOW', win!.t) }
      else if (cat === 'in_transport') { status = 'IN_TRANSPORT'; slot = win!.slot; events = chainBackward(r, 'IN_TRANSPORT', win!.t) }
      else if (cat === 'start_delivery') { status = 'START_DELIVERY'; slot = win!.slot; events = chainBackward(r, 'START_DELIVERY', win!.t) }
      else {
        // assignée / non assignée / annulée : créneau du jour, reçue avant le début du créneau, jamais dans le futur
        slot = pick(r, inp.daySlots)
        const ready = Math.min(N - 10 * MIN, slot.startMs - ri(r, 30, 240) * MIN)
        events = [{ fromStatus: null, toStatus: 'READY_PICKUP', at: new Date(ready) }]
        if (cat === 'assigned') { status = 'ASSIGNED'; events.push({ fromStatus: 'READY_PICKUP', toStatus: 'ASSIGNED', at: new Date(Math.max(ready + MIN, Math.min(N - 2 * MIN, ready + ri(r, 5, 40) * MIN))) }) }
        else if (cat === 'cancelled') { status = 'CANCELLED'; events.push({ fromStatus: 'READY_PICKUP', toStatus: 'CANCELLED', at: new Date(Math.max(ready + MIN, Math.min(N - MIN, ready + ri(r, 10, 120) * MIN))) }) }
        else status = 'READY_PICKUP'
      }
      finalStatus = status

      const at = (s: string) => events.find(e => e.toStatus === s)?.at ?? null
      const deliveredAt = at('DELIVERED')
      let collectedAt: Date | null = null, collectionMethod: string | null = null
      if (cat === 'collected' && deliveredAt) {
        collectedAt = new Date(Math.max(deliveredAt.getTime() + MIN, Math.min(N - MIN, deliveredAt.getTime() + ri(r, 20, 180) * MIN)))
        collectionMethod = pick(r, METHODS)
        events.push({ fromStatus: 'DELIVERED', toStatus: 'COLLECTED', at: collectedAt })
      }

      const amount = Math.round((80 + r() * 820) / 5) * 5 // 80–900 MAD
      const lat = clat + (r() - 0.5) * 0.07, lng = clng + (r() - 0.5) * 0.07
      const dist = districts
      const lastAt = events[events.length - 1].at
      const startDeliveryAt = at('START_DELIVERY')
      specs.push({
        category: cat, externalId: ref, reference: ref, hubCode: hub.code, city: hub.city, district: pick(r, dist),
        status: finalStatus, slotLabel: slot.label, slotStart: new Date(slot.startMs), slotEnd: new Date(slot.endMs),
        amount, customerName: `${pick(r, FIRST)} ${pick(r, LAST)}`, customerPhone: `060000${String(ri(r, 0, 9999)).padStart(4, '0')}`,
        address: `${ri(r, 1, 120)} ${pick(r, STREETS)}, ${pick(r, dist)}`, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6,
        driverId: driver?.id ?? null, courierRef: driver?.code ?? null,
        createdAtSrc: events[0].at, assignedAt: at('ASSIGNED'), inTransportAt: at('IN_TRANSPORT'), startDeliveryAt, deliveredAt, noShowAt: at('NO_SHOW'),
        arrivedAt: deliveredAt && startDeliveryAt ? new Date(Math.max(startDeliveryAt.getTime() + MIN, deliveredAt.getTime() - ri(r, 2, 8) * MIN)) : null,
        deliveredLat: deliveredAt ? Math.round((lat + (r() - 0.5) * 0.0004) * 1e6) / 1e6 : null, deliveredLng: deliveredAt ? Math.round((lng + (r() - 0.5) * 0.0004) * 1e6) / 1e6 : null,
        collectedAt, collectedAmount: collectedAt ? amount : null, collectedBy: collectedAt ? 'Démo (caisse)' : null, collectionMethod,
        reasonCode: cat === 'no_show' && inp.reasonCodes.length ? pick(r, inp.reasonCodes) : null,
        cancelReason: cat === 'cancelled' ? 'Annulée par le client (démo)' : null,
        sourceUpdatedAt: collectedAt ?? lastAt, events,
        items: Array.from({ length: ri(r, 1, 3) }, (_, k) => { const p = pick(r, PRODUCTS); return { sku: `DEMO-SKU-${hashStr(p) % 1000}`, label: p, qty: ri(r, 1, 3), barcode: `DEMO${hashStr(ref + k) % 100000000}` } }),
      })
    }
  })
  return { specs, warnings }
}

/** Compteurs attendus d'un plan (pour les tests et l'aperçu). */
export function summarize(specs: DemoSpec[]) {
  const c: Record<string, number> = {}
  for (const s of specs) c[s.category] = (c[s.category] ?? 0) + 1
  return c
}
