// Logique hors-ligne de l'application livreur : machine à états locale (identique au serveur), file d'actions,
// traitement des résultats de synchro (fonctions PURES, testées par scripts/test-driver-offline.mjs) et
// stockage IndexedDB avec repli en mémoire (navigation privée). Aucun accès DOM à l'import.

export type ActionType = 'accept' | 'start' | 'deliver' | 'noshow' | 'checkin' | 'checkout'
export type QueueState = 'pending' | 'sending' | 'error'
export interface Geo { lat: number; lng: number; accuracy?: number }

export interface DriverOrder {
  id: string; ref: string; status: string; slotLabel: string | null; slotStart: string | null; slotEnd: string | null
  customerName: string | null; district: string | null; address: string | null; lat: number | null; lng: number | null
  amount: number | null; customerPhone: string | null; otpRequired: boolean; otpVerified: boolean; otpAttempts: number
  lateMin: number | null; hasProof: boolean
}

export interface QueueItem {
  id: string; seq: number; type: ActionType; orderId?: string; at: string; geo?: Geo; otp?: string; reason?: string
  proofClientIds?: string[]; tries: number; state: QueueState; errorCode?: string; lastTryAt?: string
}

export interface ProofRec {
  clientId: string; orderId: string; kind: 'delivery' | 'noshow' | 'damage'; mime: string; dataBase64: string
  geo?: Geo; takenAt: string; uploaded: boolean; tries?: number
}

export interface SyncResult { id: string; ok: boolean; code?: string; error?: string; order?: { id: string; status: string }; attendance?: unknown }

export interface OrdersSnapshot {
  key: 'snap'; orders: DriverOrder[]; serverTime: string | null; driver: unknown; config: unknown; savedAt: string
}

export type ViewOrder = DriverOrder & { localPending: boolean; errorItem: QueueItem | null }

// ───────────────────────── machine à états (miroir du serveur) ─────────────────────────

const TRANSITIONS: Record<string, [string, string]> = {
  accept: ['ASSIGNED', 'IN_TRANSPORT'],
  start: ['IN_TRANSPORT', 'START_DELIVERY'],
  deliver: ['START_DELIVERY', 'DELIVERED'],
  noshow: ['START_DELIVERY', 'NO_SHOW'],
}
export const ACTIVE_STATUSES = ['ASSIGNED', 'IN_TRANSPORT', 'START_DELIVERY']
export const DONE_STATUSES = ['DELIVERED', 'NO_SHOW']

/** Statut résultant d'une action, ou null si la transition est interdite. checkin/checkout ne changent aucun statut (renvoient `status`). */
export function nextStatus(status: string, type: ActionType): string | null {
  if (type === 'checkin' || type === 'checkout') return status
  const t = TRANSITIONS[type]
  if (!t) return null
  return t[0] === status ? t[1] : null
}
export const canApply = (status: string, type: ActionType) => nextStatus(status, type) !== null

/** Action « suivante » naturelle pour un statut (null si terminé). */
export function nextAction(status: string): 'accept' | 'start' | 'deliver' | null {
  return status === 'ASSIGNED' ? 'accept' : status === 'IN_TRANSPORT' ? 'start' : status === 'START_DELIVERY' ? 'deliver' : null
}

/** Applique les actions en file (pending/sending, par ordre de seq) sur le statut de base ; les actions en erreur sont ignorées. */
export function effectiveStatus(base: string, items: QueueItem[]): string {
  let s = base
  for (const it of [...items].sort((a, b) => a.seq - b.seq)) {
    if (it.state === 'error') continue
    const n = nextStatus(s, it.type)
    if (n) s = n
  }
  return s
}

/** Commandes telles qu'affichées : statut optimiste + indicateurs « en attente » / « erreur ». */
export function effectiveOrders(orders: DriverOrder[], queue: QueueItem[]): ViewOrder[] {
  return orders.map(o => {
    const mine = queue.filter(q => q.orderId === o.id)
    const live = mine.filter(q => q.state !== 'error')
    return {
      ...o,
      status: effectiveStatus(o.status, mine),
      localPending: live.length > 0,
      errorItem: mine.find(q => q.state === 'error') ?? null,
    }
  })
}

// ───────────────────────── validation côté téléphone ─────────────────────────

export const OTP_RE = /^\d{4}$/
export function validateAction(type: ActionType, d: { otp?: string; reason?: string; proofCount: number }): string | null {
  if (type === 'deliver') return OTP_RE.test((d.otp ?? '').trim()) || d.proofCount > 0 ? null : 'deliver.need'
  if (type === 'noshow') return (d.reason ?? '').trim().length >= 3 && d.proofCount > 0 ? null : 'noshow.need'
  return null
}

// ───────────────────────── file d'actions ─────────────────────────

export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const nextSeq = (queue: QueueItem[]) => queue.reduce((m, q) => Math.max(m, q.seq), 0) + 1
export const pendingCount = (queue: QueueItem[]) => queue.filter(q => q.state !== 'error').length

/**
 * Actions à envoyer, DANS L'ORDRE (seq). Un id n'est jamais dupliqué ; une action 'sending' (envoi interrompu) est rejouée avec LE MÊME id.
 * Les actions en erreur sont exclues, et bloquent les suivantes de la même commande (elles dépendent de l'état attendu).
 */
export function selectSendable(queue: QueueItem[]): QueueItem[] {
  const blocked = new Set<string>()
  const out: QueueItem[] = []
  const seen = new Set<string>()
  for (const it of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    if (it.state === 'error') { if (it.orderId) blocked.add(it.orderId); continue }
    if (it.orderId && blocked.has(it.orderId)) continue
    out.push(it)
  }
  return out
}

/** Corps de POST /api/driver/sync (sans champs internes). */
export function buildSyncBody(items: QueueItem[]) {
  return {
    actions: items.map(i => {
      const a: Record<string, unknown> = { id: i.id, type: i.type, at: i.at }
      if (i.orderId) a.orderId = i.orderId
      if (i.geo) a.geo = i.geo
      if (i.otp) a.otp = i.otp
      if (i.reason) a.reason = i.reason
      if (i.proofClientIds?.length) a.proofClientIds = i.proofClientIds
      return a
    }),
  }
}

export interface ApplyOutcome { queue: QueueItem[]; removed: string[]; resync: boolean; notices: { id: string; code: string }[] }

/**
 * Applique les résultats serveur à la file. `sentIds` = ids réellement envoyés dans cette requête.
 * ok → retiré ; BAD_STATE → retiré + resynchronisation + avis ; autre erreur → état 'error' (code conservé, rien n'est renvoyé tout seul) ;
 * pas de résultat pour un id envoyé → redevient 'pending' (même id au prochain essai).
 */
export function applyResults(queue: QueueItem[], sentIds: string[], results: SyncResult[], nowIso: string): ApplyOutcome {
  const byId = new Map(results.map(r => [r.id, r]))
  const sent = new Set(sentIds)
  const removed: string[] = []
  const notices: { id: string; code: string }[] = []
  let resync = false
  const out: QueueItem[] = []
  for (const it of queue) {
    if (!sent.has(it.id)) { out.push(it); continue }
    const r = byId.get(it.id)
    if (!r) { out.push({ ...it, state: 'pending', lastTryAt: nowIso }); continue }
    if (r.ok) { removed.push(it.id); resync = true; continue }
    const code = r.code || 'UNKNOWN'
    if (code === 'BAD_STATE') { removed.push(it.id); resync = true; notices.push({ id: it.id, code }); continue }
    notices.push({ id: it.id, code })
    out.push({ ...it, state: 'error', errorCode: code, lastTryAt: nowIso })
  }
  return { queue: out, removed, resync, notices }
}

/** Marque des actions comme « en cours d'envoi » (tries incrémenté une seule fois par envoi). */
export function markSending(queue: QueueItem[], ids: string[], nowIso: string): QueueItem[] {
  const s = new Set(ids)
  return queue.map(q => (s.has(q.id) && q.state !== 'error' ? { ...q, state: 'sending' as const, tries: q.tries + 1, lastTryAt: nowIso } : q))
}
/** Envoi échoué côté réseau : les actions 'sending' redeviennent 'pending' (conservées, même id). */
export function releaseSending(queue: QueueItem[], ids: string[]): QueueItem[] {
  const s = new Set(ids)
  return queue.map(q => (s.has(q.id) && q.state === 'sending' ? { ...q, state: 'pending' as const } : q))
}

/** Ressaisie du code après OTP_INVALID : l'action repasse en 'pending' avec le nouveau code (même id, aucune tentative automatique). */
export function retryWithOtp(queue: QueueItem[], id: string, otp: string): QueueItem[] {
  if (!OTP_RE.test(otp)) return queue
  return queue.map(q => (q.id === id && q.state === 'error' && q.errorCode === 'OTP_INVALID' ? { ...q, otp, state: 'pending' as const, errorCode: undefined } : q))
}

/** Attente avant la nouvelle tentative n (1, 2, 3…) : 1 s, 2 s, 4 s. */
export const backoffMs = (attempt: number) => 1000 * 2 ** Math.max(0, Math.min(attempt - 1, 4))

// ───────────────────────── codes d'erreur → clés de message ─────────────────────────

const ERR_KEYS: Record<string, string> = {
  BAD_STATE: 'err.BAD_STATE', OTP_INVALID: 'err.OTP_INVALID', OTP_LOCKED: 'err.OTP_LOCKED', PERIOD_LOCKED: 'err.PERIOD_LOCKED',
  PROOF_REQUIRED: 'err.PROOF_REQUIRED', PROOF_REJECTED: 'err.PROOF_REJECTED', UNAUTHORIZED: 'err.UNAUTHORIZED', NETWORK: 'err.NETWORK', RATE: 'err.RATE',
}
export const ERROR_CODES = Object.keys(ERR_KEYS)
export const errorKey = (code?: string | null) => (code && ERR_KEYS[code]) || 'err.UNKNOWN'
/** Code d'erreur HTTP → code interne. */
export function httpErrorCode(status: number): string {
  return status === 401 ? 'UNAUTHORIZED' : status === 429 ? 'RATE' : status === 413 || status === 400 || status === 422 ? 'PROOF_REJECTED' : 'NETWORK'
}

// ───────────────────────── tri / urgence ─────────────────────────

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN)
/** Commandes à faire triées par fin de créneau croissante (sans créneau en dernier). */
export function sortToday<T extends DriverOrder>(orders: T[]): T[] {
  return orders.filter(o => ACTIVE_STATUSES.includes(o.status)).sort((a, b) => {
    const x = ms(a.slotEnd), y = ms(b.slotEnd)
    if (isNaN(x) && isNaN(y)) return a.ref.localeCompare(b.ref)
    if (isNaN(x)) return 1
    if (isNaN(y)) return -1
    return x - y
  })
}
export const sortDone = <T extends DriverOrder>(orders: T[]) => orders.filter(o => DONE_STATUSES.includes(o.status))

/** 'late' si le créneau est dépassé, 'soon' s'il reste moins de 45 min, sinon 'ok'. `min` = minutes (négatif si en retard). */
export function urgency(o: Pick<DriverOrder, 'slotEnd' | 'lateMin'>, nowMs: number): { level: 'late' | 'soon' | 'ok'; min: number } {
  const e = ms(o.slotEnd)
  if (!isNaN(e)) {
    const min = Math.round((e - nowMs) / 60000)
    return { level: min < 0 ? 'late' : min < 45 ? 'soon' : 'ok', min: Math.abs(min) }
  }
  return (o.lateMin ?? 0) > 0 ? { level: 'late', min: o.lateMin ?? 0 } : { level: 'ok', min: 0 }
}

// ───────────────────────── stockage IndexedDB (repli mémoire) ─────────────────────────

export interface Store {
  mode: 'idb' | 'memory'
  queueAll(): Promise<QueueItem[]>
  queuePut(i: QueueItem): Promise<void>
  queueDel(id: string): Promise<void>
  proofsAll(): Promise<ProofRec[]>
  proofPut(p: ProofRec): Promise<void>
  proofDel(clientId: string): Promise<void>
  snapGet(): Promise<OrdersSnapshot | null>
  snapSet(s: OrdersSnapshot): Promise<void>
}

export function memoryStore(): Store {
  const q = new Map<string, QueueItem>(), p = new Map<string, ProofRec>()
  let snap: OrdersSnapshot | null = null
  return {
    mode: 'memory',
    async queueAll() { return [...q.values()] },
    async queuePut(i) { q.set(i.id, i) },
    async queueDel(id) { q.delete(id) },
    async proofsAll() { return [...p.values()] },
    async proofPut(x) { p.set(x.clientId, x) },
    async proofDel(id) { p.delete(id) },
    async snapGet() { return snap },
    async snapSet(s) { snap = s },
  }
}

const DB_NAME = 'shipinfy-driver', DB_VER = 1

function wrap<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}

/** Ouvre IndexedDB ; en cas d'indisponibilité (navigation privée, quota, API absente) renvoie un magasin mémoire (mode dégradé). */
export async function openStore(): Promise<Store> {
  try {
    if (typeof indexedDB === 'undefined') return memoryStore()
    const db: IDBDatabase = await new Promise((res, rej) => {
      const open = indexedDB.open(DB_NAME, DB_VER)
      open.onupgradeneeded = () => {
        const d = open.result
        if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id' })
        if (!d.objectStoreNames.contains('proofs')) d.createObjectStore('proofs', { keyPath: 'clientId' })
        if (!d.objectStoreNames.contains('orders')) d.createObjectStore('orders', { keyPath: 'key' })
      }
      open.onsuccess = () => res(open.result)
      open.onerror = () => rej(open.error)
      open.onblocked = () => rej(new Error('blocked'))
    })
    const st = (name: string, mode: IDBTransactionMode) => db.transaction(name, mode).objectStore(name)
    // test d'écriture réel (Safari privé ouvre la base mais refuse d'écrire)
    await wrap(st('orders', 'readwrite').put({ key: 'probe', at: Date.now() })).then(() => wrap(st('orders', 'readwrite').delete('probe')))
    return {
      mode: 'idb',
      queueAll: () => wrap(st('queue', 'readonly').getAll()) as Promise<QueueItem[]>,
      queuePut: async i => { await wrap(st('queue', 'readwrite').put(i)) },
      queueDel: async id => { await wrap(st('queue', 'readwrite').delete(id)) },
      proofsAll: () => wrap(st('proofs', 'readonly').getAll()) as Promise<ProofRec[]>,
      proofPut: async p => { await wrap(st('proofs', 'readwrite').put(p)) },
      proofDel: async id => { await wrap(st('proofs', 'readwrite').delete(id)) },
      snapGet: async () => ((await wrap(st('orders', 'readonly').get('snap'))) as OrdersSnapshot | undefined) ?? null,
      snapSet: async s => { await wrap(st('orders', 'readwrite').put(s)) },
    }
  } catch {
    return memoryStore()
  }
}
