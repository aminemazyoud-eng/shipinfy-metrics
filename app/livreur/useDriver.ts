'use client'
// Moteur de l'application livreur : jeton, cache IndexedDB, file d'actions, synchronisation, géolocalisation.
// La logique pure (états, file, résultats) est dans lib/driver-offline.ts ; ici seulement les effets (fetch, IndexedDB, évènements).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyResults, backoffMs, buildSyncBody, effectiveOrders, errorKey, httpErrorCode, markSending, newId, nextSeq, openStore, pendingCount,
  releaseSending, retryWithOtp, selectSendable,
  type ActionType, type DriverOrder, type Geo, type ProofRec, type QueueItem, type Store, type SyncResult,
} from '@/lib/driver-offline'
import { detectLang, type Lang } from '@/lib/driver-i18n'

export interface DriverMe { code: string; name: string; firstName: string | null; lang: string | null; hubCode: string | null; hubName: string | null; hubLat: number | null; hubLng: number | null; vehicle: string | null; plate: string | null }
export interface DriverConfig { geofenceMeters: number; deliveryGeofenceMeters: number; photoMaxKB: number; proofRequired: boolean; otpRequired: boolean }
export type AuthState = 'loading' | 'ok' | 'expired' | 'notoken' | 'config'
export interface Notice { id: string; key: string; params?: Record<string, string | number> }
export interface AttDay { day: string; inAt?: string; outAt?: string }

const TOKEN_KEY = 'drv_token', LANG_KEY = 'drv_lang', ATT_KEY = 'drv_att'
const DEFAULT_CONFIG: DriverConfig = { geofenceMeters: 300, deliveryGeofenceMeters: 300, photoMaxKB: 300, proofRequired: true, otpRequired: false }

const ls = {
  get(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* stockage indisponible */ } },
  del(k: string) { try { localStorage.removeItem(k) } catch { /* idem */ } },
}
const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' })

/** Position GPS haute précision, jamais bloquante : résout `undefined` après `maxWaitMs` ou en cas de refus. */
export function getGeo(maxWaitMs = 10_000): Promise<Geo | undefined> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(undefined)
    let done = false
    const fin = (g?: Geo) => { if (!done) { done = true; resolve(g) } }
    const t = setTimeout(() => fin(undefined), maxWaitMs)
    try {
      navigator.geolocation.getCurrentPosition(
        p => { clearTimeout(t); fin({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }) },
        () => { clearTimeout(t); fin(undefined) },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 },
      )
    } catch { clearTimeout(t); fin(undefined) }
  })
}

export function useDriver() {
  const [auth, setAuth] = useState<AuthState>('loading')
  const [me, setMe] = useState<DriverMe | null>(null)
  const [config, setConfig] = useState<DriverConfig>(DEFAULT_CONFIG)
  const [orders, setOrders] = useState<DriverOrder[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [lang, setLangState] = useState<Lang>('fr')
  const [reachable, setReachable] = useState(true)
  const [browserOnline, setBrowserOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [storeMode, setStoreMode] = useState<'idb' | 'memory' | null>(null)
  const [firstLoadFailed, setFirstLoadFailed] = useState(false)
  const [att, setAtt] = useState<AttDay>({ day: todayKey() })

  const storeRef = useRef<Store | null>(null)
  const tokenRef = useRef<string | null>(null)
  const queueRef = useRef<QueueItem[]>([])
  const syncLock = useRef(false)
  const langChosen = useRef(false)
  const memProofs = useRef(new Map<string, ProofRec>()) // copie mémoire des photos (utile si IndexedDB est indisponible)

  const setQ = useCallback((q: QueueItem[]) => { queueRef.current = q; setQueue(q) }, [])
  const notify = useCallback((key: string, params?: Record<string, string | number>) => {
    setNotices(n => [...n.filter(x => x.key !== key).slice(-3), { id: newId(), key, params }])
  }, [])
  const dismiss = useCallback((id: string) => setNotices(n => n.filter(x => x.id !== id)), [])

  const setLang = useCallback((l: Lang) => { langChosen.current = true; setLangState(l); ls.set(LANG_KEY, l) }, [])

  /** fetch avec jeton ; 401 → écran « lien expiré » ; erreurs réseau → exception. */
  const api = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const r = await fetch(path, { ...init, cache: 'no-store', headers: { ...(init?.headers ?? {}), 'x-driver-token': tokenRef.current ?? '' } })
    setReachable(true)
    if (r.status === 401) setAuth('expired')
    return r
  }, [])

  const saveSnap = useCallback(async (o: DriverOrder[], serverTime: string | null, m: DriverMe | null, c: DriverConfig) => {
    try { await storeRef.current?.snapSet({ key: 'snap', orders: o, serverTime, driver: m, config: c, savedAt: new Date().toISOString() }) } catch { /* cache non critique */ }
  }, [])

  const meRef = useRef<DriverMe | null>(null), cfgRef = useRef<DriverConfig>(DEFAULT_CONFIG)

  const refreshOrders = useCallback(async (): Promise<boolean> => {
    try {
      const r = await api('/api/driver/orders')
      if (r.status === 503) { setAuth(a => (a === 'loading' ? 'config' : a)); return false }
      if (r.status === 429) { notify('warn.rate'); return false }
      if (!r.ok) return false
      const j = (await r.json()) as { serverTime?: string; orders?: DriverOrder[] }
      const list = Array.isArray(j.orders) ? j.orders : []
      setOrders(list); setFirstLoadFailed(false)
      await saveSnap(list, j.serverTime ?? null, meRef.current, cfgRef.current)
      return true
    } catch { setReachable(false); return false }
  }, [api, notify, saveSnap])

  const loadMe = useCallback(async (): Promise<boolean> => {
    try {
      const r = await api('/api/driver/me')
      if (r.status === 503) { setAuth(a => (a === 'loading' ? 'config' : a)); return false }
      if (!r.ok) return false
      const j = (await r.json()) as { driver: DriverMe; config?: Partial<DriverConfig> }
      meRef.current = j.driver; cfgRef.current = { ...DEFAULT_CONFIG, ...(j.config ?? {}) }
      setMe(j.driver); setConfig(cfgRef.current)
      setAuth(a => (a === 'expired' ? a : 'ok'))
      if (!langChosen.current) setLangState(detectLang(j.driver.lang, navigator.language))
      return true
    } catch { setReachable(false); return false }
  }, [api])

  // ───────── synchronisation : photos d'abord, puis actions dans l'ordre ─────────
  const uploadProof = useCallback(async (p: ProofRec): Promise<'ok' | 'rejected' | 'retry'> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await api('/api/driver/proof', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: p.clientId, orderId: p.orderId, kind: p.kind, mime: p.mime, dataBase64: p.dataBase64, geo: p.geo, takenAt: p.takenAt }),
        })
        if (r.ok) return 'ok'
        if (r.status === 401) return 'retry'
        if (httpErrorCode(r.status) === 'PROOF_REJECTED') return 'rejected'
      } catch { setReachable(false) }
      if (attempt < 3) await new Promise(res => setTimeout(res, backoffMs(attempt)))
    }
    return 'retry'
  }, [api])

  const persistQueue = useCallback(async (next: QueueItem[], removed: string[] = []) => {
    const st = storeRef.current
    const prev = new Map(queueRef.current.map(q => [q.id, q]))
    setQ(next)
    if (!st) return
    try {
      for (const id of removed) await st.queueDel(id)
      for (const it of next) if (prev.get(it.id) !== it) await st.queuePut(it)
    } catch { /* IndexedDB en échec : l'état mémoire reste la référence */ }
  }, [setQ])

  const runSync = useCallback(async (manual = false) => {
    if (syncLock.current || !tokenRef.current) return
    syncLock.current = true; setSyncing(true)
    try {
      const st = storeRef.current
      let q = queueRef.current
      const sendable0 = selectSendable(q)
      if (sendable0.length) {
        // 1) photos (idempotent par clientId)
        const proofs = new Map((st ? await st.proofsAll().catch(() => [] as ProofRec[]) : []).map(p => [p.clientId, p]))
        for (const mem of memProofs.current.values()) proofs.set(mem.clientId, mem)
        const rejected = new Set<string>()
        for (const it of sendable0) {
          for (const cid of it.proofClientIds ?? []) {
            const p = proofs.get(cid)
            if (!p || p.uploaded) continue
            const res = await uploadProof(p)
            if (res === 'ok') {
              const up = { ...p, uploaded: true }; proofs.set(cid, up); memProofs.current.set(cid, up)
              try { await st?.proofPut(up) } catch { /* ignoré */ }
            } else if (res === 'rejected') rejected.add(it.id)
            else { if (manual) notify('err.NETWORK'); return } // réseau/401 : on garde tout et on réessaiera
          }
        }
        if (rejected.size) {
          const next = queueRef.current.map(x => (rejected.has(x.id) ? { ...x, state: 'error' as const, errorCode: 'PROOF_REJECTED' } : x))
          await persistQueue(next); q = next
        }
        // 2) actions dans l'ordre
        const toSend = selectSendable(q)
        if (toSend.length) {
          const ids = toSend.map(x => x.id)
          const now = new Date().toISOString()
          await persistQueue(markSending(queueRef.current, ids, now))
          let results: SyncResult[] | null = null
          try {
            const r = await api('/api/driver/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildSyncBody(toSend)) })
            if (r.ok) results = ((await r.json()) as { results?: SyncResult[] }).results ?? []
            else if (r.status === 429) notify('warn.rate')
          } catch { setReachable(false) }
          if (!results) { await persistQueue(releaseSending(queueRef.current, ids)); return }
          const out = applyResults(queueRef.current, ids, results, new Date().toISOString())
          await persistQueue(out.queue, out.removed)
          // nettoyage des photos des actions terminées
          for (const id of out.removed) {
            const it = toSend.find(x => x.id === id)
            for (const cid of it?.proofClientIds ?? []) { memProofs.current.delete(cid); try { await st?.proofDel(cid) } catch { /* ignoré */ } }
          }
          for (const n of out.notices) notify(n.code === 'BAD_STATE' ? 'notice.alreadyUpdated' : errorKey(n.code))
          if (out.removed.length && !out.notices.length) notify('notice.sent')
          await refreshOrders()
          setLastSync(new Date().toISOString())
          return
        }
      }
      // file vide : simple rafraîchissement
      if (await refreshOrders()) setLastSync(new Date().toISOString())
    } finally { syncLock.current = false; setSyncing(false) }
  }, [api, notify, persistQueue, refreshOrders, uploadProof])

  /** Enregistre une action (et ses photos) dans la file locale, puis tente l'envoi. Ne perd jamais l'action. */
  const enqueue = useCallback(async (a: { type: ActionType; orderId?: string; otp?: string; reason?: string; geo?: Geo; photos?: { dataBase64: string; mime: string }[]; kind?: 'delivery' | 'noshow' | 'damage' }) => {
    const at = new Date().toISOString()
    const proofIds: string[] = []
    for (const ph of a.photos ?? []) {
      const rec: ProofRec = { clientId: newId(), orderId: a.orderId ?? '', kind: a.kind ?? 'delivery', mime: ph.mime, dataBase64: ph.dataBase64, geo: a.geo, takenAt: at, uploaded: false }
      memProofs.current.set(rec.clientId, rec)
      try { await storeRef.current?.proofPut(rec) } catch { /* mémoire seulement */ }
      proofIds.push(rec.clientId)
    }
    const item: QueueItem = {
      id: newId(), seq: nextSeq(queueRef.current), type: a.type, orderId: a.orderId, at, geo: a.geo,
      otp: a.otp?.trim() || undefined, reason: a.reason?.trim() || undefined, proofClientIds: proofIds.length ? proofIds : undefined, tries: 0, state: 'pending',
    }
    await persistQueue([...queueRef.current, item])
    if (a.type === 'checkin' || a.type === 'checkout') {
      const cur = ls.get(ATT_KEY)
      let day: AttDay = { day: todayKey() }
      try { const p = cur ? (JSON.parse(cur) as AttDay) : null; if (p?.day === day.day) day = p } catch { /* ignoré */ }
      if (a.type === 'checkin') day.inAt = at; else day.outAt = at
      ls.set(ATT_KEY, JSON.stringify(day)); setAtt(day)
    }
    if (navigator.onLine) void runSync()
  }, [persistQueue, runSync])

  const reenterOtp = useCallback(async (id: string, otp: string) => {
    const next = retryWithOtp(queueRef.current, id, otp)
    if (next !== queueRef.current) { await persistQueue(next); if (navigator.onLine) void runSync() }
  }, [persistQueue, runSync])

  const discard = useCallback(async (id: string) => {
    const it = queueRef.current.find(q => q.id === id)
    if (!it) return
    await persistQueue(queueRef.current.filter(q => q.id !== id), [id])
    for (const cid of it.proofClientIds ?? []) { memProofs.current.delete(cid); try { await storeRef.current?.proofDel(cid) } catch { /* ignoré */ } }
  }, [persistQueue])

  // ───────── démarrage ─────────
  useEffect(() => {
    let dead = false
    ;(async () => {
      // jeton : ?t= au premier lancement → localStorage → nettoyage de l'URL
      let tok: string | null = null
      try {
        const u = new URL(window.location.href)
        const t = u.searchParams.get('t')
        if (t) { ls.set(TOKEN_KEY, t); u.searchParams.delete('t'); window.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash) }
      } catch { /* ignoré */ }
      tok = ls.get(TOKEN_KEY)
      tokenRef.current = tok
      const savedLang = ls.get(LANG_KEY)
      if (savedLang === 'fr' || savedLang === 'ar') { langChosen.current = true; setLangState(savedLang) } else setLangState(detectLang(null, navigator.language))
      setBrowserOnline(navigator.onLine)
      try { const p = JSON.parse(ls.get(ATT_KEY) ?? 'null') as AttDay | null; if (p?.day === todayKey()) setAtt(p) } catch { /* ignoré */ }

      const st = await openStore()
      if (dead) return
      storeRef.current = st; setStoreMode(st.mode)
      const [q, snap] = await Promise.all([st.queueAll().catch(() => [] as QueueItem[]), st.snapGet().catch(() => null)])
      // un envoi interrompu (état 'sending') est rejoué avec le même id
      const qq = q.map(x => (x.state === 'sending' ? { ...x, state: 'pending' as const } : x))
      setQ(qq)
      if (snap) {
        setOrders(snap.orders ?? [])
        if (snap.driver) { meRef.current = snap.driver as DriverMe; setMe(snap.driver as DriverMe); if (!savedLang) setLangState(detectLang((snap.driver as DriverMe).lang, navigator.language)) }
        if (snap.config) { cfgRef.current = { ...DEFAULT_CONFIG, ...(snap.config as DriverConfig) }; setConfig(cfgRef.current) }
        if (snap.savedAt) setLastSync(snap.savedAt)
      }
      if (!tok) { setAuth(snap?.driver ? 'ok' : 'notoken'); return }
      if (snap?.driver) setAuth('ok')
      const ok = await loadMe()
      if (dead) return
      if (!ok && !snap?.driver) { setFirstLoadFailed(true); setAuth(a => (a === 'loading' ? 'ok' : a)) }
      await runSync()
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // réseau : évènements online/offline, ping 15 s quand la file est non vide, rafraîchissement 60 s sinon
  useEffect(() => {
    const on = () => { setBrowserOnline(true); void runSync() }
    const off = () => setBrowserOnline(false)
    const vis = () => { if (!document.hidden) void runSync() }
    window.addEventListener('online', on); window.addEventListener('offline', off); document.addEventListener('visibilitychange', vis)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', vis) }
  }, [runSync])

  const pend = pendingCount(queue)
  useEffect(() => {
    if (auth === 'expired' || auth === 'notoken') return
    const everyMs = pend > 0 ? 15_000 : 60_000
    const t = setInterval(async () => {
      if (document.hidden || !tokenRef.current) return
      if (pend > 0) {
        try { const r = await api('/api/driver/ping'); if (r.ok) void runSync() } catch { setReachable(false) }
      } else void runSync()
    }, everyMs)
    return () => clearInterval(t)
  }, [pend, auth, api, runSync])

  // service worker : enregistrement + mise en cache des assets déjà chargés
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').then(async reg => {
      await navigator.serviceWorker.ready
      const urls = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/_next/static/'))
      reg.active?.postMessage({ type: 'CACHE_URLS', urls: [...urls, '/manifest.webmanifest', '/logo.png'] })
    }).catch(() => { /* SW indisponible : l'app fonctionne en ligne seulement */ })
  }, [])

  const view = useMemo(() => effectiveOrders(orders, queue), [orders, queue])
  const online = browserOnline && reachable

  return { auth, me, config, lang, setLang, view, queue, online, syncing, lastSync, notices, dismiss, storeMode, firstLoadFailed, att, pending: pend, enqueue, runSync, reenterOtp, discard, retryAuth: async () => { setAuth('loading'); const ok = await loadMe(); if (ok) await runSync(); else setAuth(a => (a === 'loading' ? 'config' : a)) } }
}
