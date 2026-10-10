'use client'
// Moteur de l'application livreur : jeton, cache IndexedDB, file d'actions, synchronisation, géolocalisation, tournée, chargement, suivi GPS.
// La logique pure (états, file, résultats) est dans lib/driver-offline.ts ; ici seulement les effets (fetch, IndexedDB, évènements).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyResults, backoffMs, buildSyncBody, cleanBarcode, effectiveOrders, errorKey, FALLBACK_REASONS, httpErrorCode, markSending, newId, nextSeq, openStore, parseTour, pendingCount,
  releaseSending, retryWithOtp, selectSendable,
  type ActionType, type DriverOrder, type DriverReason, type Geo, type LoadOverview, type ProofRec, type QueueItem, type Store, type StoredPoint, type SyncResult, type TourState,
} from '@/lib/driver-offline'
import { shouldKeepPoint, type TrackPoint } from '@/lib/geo'
import { detectLang, type Lang } from '@/lib/driver-i18n'

export interface DriverMe { code: string; name: string; firstName: string | null; lang: string | null; hubCode: string | null; hubName: string | null; hubLat: number | null; hubLng: number | null; vehicle: string | null; plate: string | null }
export interface DriverConfig { geofenceMeters: number; deliveryGeofenceMeters: number; photoMaxKB: number; proofRequired: boolean; otpRequired: boolean; geofenceMode: 'block' | 'soft'; loadScanRequired: boolean }
export type AuthState = 'loading' | 'ok' | 'expired' | 'notoken' | 'config'
export interface Notice { id: string; key: string; params?: Record<string, string | number> }
export interface AttDay { day: string; inAt?: string; outAt?: string }
export type GpsState = 'off' | 'active' | 'denied'
export interface KmDay { day: string; start?: number; end?: number }
export interface ScanOutcome { ok: boolean; code?: string; label?: string; checkin?: { done: boolean; code?: string } }

const TOKEN_KEY = 'drv_token', LANG_KEY = 'drv_lang', ATT_KEY = 'drv_att', REASONS_KEY = 'drv_reasons', KM_KEY = 'drv_km'
const DEFAULT_CONFIG: DriverConfig = { geofenceMeters: 400, deliveryGeofenceMeters: 400, photoMaxKB: 300, proofRequired: true, otpRequired: false, geofenceMode: 'block', loadScanRequired: true }
const EMPTY_TOUR: TourState = { tour: null, stops: [] }
const MAX_BUFFERED_POINTS = 2000, POINTS_PER_CALL = 200, MAX_POINT_ACCURACY_M = 500

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

type WakeLockLike = { release: () => Promise<void> }
type NavWithWakeLock = Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } }

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
  const [tour, setTour] = useState<TourState>(EMPTY_TOUR)
  const [load, setLoad] = useState<LoadOverview | null>(null)
  const [reasons, setReasons] = useState<DriverReason[]>(FALLBACK_REASONS)
  const [reasonsLive, setReasonsLive] = useState(false)
  const [gps, setGps] = useState<GpsState>('off')
  const [gpsPending, setGpsPending] = useState(0)
  const [km, setKm] = useState<KmDay>({ day: todayKey() })

  const storeRef = useRef<Store | null>(null)
  const tokenRef = useRef<string | null>(null)
  const queueRef = useRef<QueueItem[]>([])
  const syncLock = useRef(false)
  const langChosen = useRef(false)
  const memProofs = useRef(new Map<string, ProofRec>()) // copie mémoire des photos (utile si IndexedDB est indisponible)
  const posRef = useRef<StoredPoint[]>([])               // positions GPS en attente d'envoi (file hors ligne)
  const posLock = useRef(false)
  const tourIdRef = useRef<string | null>(null)

  const setQ = useCallback((q: QueueItem[]) => { queueRef.current = q; setQueue(q) }, [])
  const notify = useCallback((key: string, params?: Record<string, string | number>) => {
    setNotices(n => [...n.filter(x => x.key !== key).slice(-3), { id: newId(), key, params }])
  }, [])
  const dismiss = useCallback((id: string) => setNotices(n => n.filter(x => x.id !== id)), [])

  const setLang = useCallback((l: Lang) => { langChosen.current = true; setLangState(l); ls.set(LANG_KEY, l) }, [])

  /** Pointage local (affichage) : modifie le jour courant et le mémorise. */
  const patchAtt = useCallback((p: { inAt?: string | null; outAt?: string | null }) => {
    let day: AttDay = { day: todayKey() }
    try { const cur = ls.get(ATT_KEY); const q = cur ? (JSON.parse(cur) as AttDay) : null; if (q?.day === day.day) day = q } catch { /* ignoré */ }
    if (p.inAt !== undefined) { if (p.inAt) day.inAt = p.inAt; else delete day.inAt }
    if (p.outAt !== undefined) { if (p.outAt) day.outAt = p.outAt; else delete day.outAt }
    ls.set(ATT_KEY, JSON.stringify(day)); setAtt({ ...day })
  }, [])

  /** fetch avec jeton ; 401 → écran « lien expiré » ; erreurs réseau → exception. */
  const api = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const r = await fetch(path, { ...init, cache: 'no-store', headers: { ...(init?.headers ?? {}), 'x-driver-token': tokenRef.current ?? '' } })
    setReachable(true)
    if (r.status === 401) setAuth('expired')
    return r
  }, [])

  const saveSnap = useCallback(async (o: DriverOrder[], serverTime: string | null, m: DriverMe | null, c: DriverConfig) => {
    try {
      const prev = await storeRef.current?.snapGet().catch(() => null)
      await storeRef.current?.snapSet({ key: 'snap', orders: o, serverTime, driver: m, config: c, savedAt: new Date().toISOString(), tour: prev?.tour ?? null })
    } catch { /* cache non critique */ }
  }, [])

  const meRef = useRef<DriverMe | null>(null), cfgRef = useRef<DriverConfig>(DEFAULT_CONFIG)

  const applyTour = useCallback(async (ts: TourState) => {
    setTour(ts); tourIdRef.current = ts.tour?.id ?? null
    try { const snap = await storeRef.current?.snapGet(); if (snap) await storeRef.current?.snapSet({ ...snap, tour: ts }) } catch { /* cache non critique */ }
  }, [])

  /** Séquence de la tournée (agent « tournées ») : toute réponse inattendue => pas de tournée, l'app retombe sur la liste de commandes. */
  const refreshTour = useCallback(async () => {
    try {
      const r = await api('/api/driver/tour')
      if (r.status === 401 || r.status === 429) return
      if (!r.ok) { if (r.status >= 400 && r.status < 500) await applyTour(EMPTY_TOUR); return }
      await applyTour(parseTour(await r.json().catch(() => null)))
    } catch { setReachable(false) }
  }, [api, applyTour])

  const refreshLoad = useCallback(async () => {
    try {
      const r = await api('/api/driver/load')
      if (!r.ok) return
      setLoad((await r.json()) as LoadOverview)
    } catch { setReachable(false) }
  }, [api])

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
      void refreshTour(); void refreshLoad()
      return true
    } catch { setReachable(false); return false }
  }, [api, notify, saveSnap, refreshTour, refreshLoad])

  const loadReasons = useCallback(async () => {
    try {
      const r = await api('/api/driver/reasons')
      if (!r.ok) return
      const j = (await r.json()) as { reasons?: DriverReason[] }
      if (Array.isArray(j.reasons) && j.reasons.length) { setReasons(j.reasons); setReasonsLive(true); ls.set(REASONS_KEY, JSON.stringify(j.reasons)) }
    } catch { /* garde la liste en cache ou de secours */ }
  }, [api])

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
      void loadReasons()
      return true
    } catch { setReachable(false); return false }
  }, [api, loadReasons])

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

  /** Report d'un stop : POST /api/driver/stop/postpone (idempotent par l'identifiant de l'action) ; la réponse est la séquence mise à jour. */
  const sendPostpone = useCallback(async (it: QueueItem): Promise<SyncResult | 'net'> => {
    try {
      const r = await api('/api/driver/stop/postpone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, orderId: it.orderId }) })
      if (r.ok) {
        // HTTP 200 même pour un refus métier : le verdict est dans `result` (BAD_STATE, MAX_POSTPONES, ALREADY_LAST, NOT_FOUND, CONFLICT, IN_PROGRESS)
        const j = await r.json().catch(() => null) as { result?: { ok?: boolean; code?: string } } | null
        const ts = parseTour(j); if (ts.tour) await applyTour(ts)
        if (j?.result?.ok === false) return j.result.code === 'IN_PROGRESS' ? 'net' : { id: it.id, ok: false, code: j.result.code === 'BAD_STATE' ? 'BAD_STATE' : 'POSTPONE_REFUSED' }
        return { id: it.id, ok: true }
      }
      if (r.status === 401 || r.status >= 500) return 'net'
      if (r.status === 429) { notify('warn.rate'); return 'net' }
      if (r.status === 409) return { id: it.id, ok: false, code: 'BAD_STATE' }
      return { id: it.id, ok: false, code: 'POSTPONE_REFUSED' }
    } catch { setReachable(false); return 'net' }
  }, [api, applyTour, notify])

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
        // 2) actions dans l'ordre : lots consécutifs vers /sync, reports vers /stop/postpone
        const toSend = selectSendable(q)
        if (toSend.length) {
          const ids = toSend.map(x => x.id)
          await persistQueue(markSending(queueRef.current, ids, new Date().toISOString()))
          const results: SyncResult[] = []
          let netFail = false
          for (let i = 0; i < toSend.length && !netFail;) {
            if (toSend[i].type === 'postpone') {
              const r = await sendPostpone(toSend[i]); i++
              if (r === 'net') netFail = true; else results.push(r)
              continue
            }
            let j = i; while (j < toSend.length && toSend[j].type !== 'postpone') j++
            const batch = toSend.slice(i, j); i = j
            try {
              const r = await api('/api/driver/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildSyncBody(batch)) })
              if (r.ok) results.push(...(((await r.json()) as { results?: SyncResult[] }).results ?? []))
              else { netFail = true; if (r.status === 429) notify('warn.rate') }
            } catch { setReachable(false); netFail = true }
          }
          if (!results.length) { await persistQueue(releaseSending(queueRef.current, ids)); return }
          const out = applyResults(queueRef.current, ids, results, new Date().toISOString())
          await persistQueue(out.queue, out.removed)
          // pointage : la réponse du serveur fait foi (arrivée refusée => on retire l'arrivée affichée)
          for (const r of results) {
            const it = toSend.find(x => x.id === r.id)
            if (!it) continue
            const a = r.attendance as { checkIn?: string | null; checkOut?: string | null } | undefined
            if (r.ok && a && (it.type === 'checkin' || it.type === 'checkout')) patchAtt({ inAt: a.checkIn ?? undefined, outAt: a.checkOut ?? undefined })
            else if (!r.ok && r.code !== 'BAD_STATE' && it.type === 'checkin') patchAtt({ inAt: null })
            else if (!r.ok && r.code !== 'BAD_STATE' && it.type === 'checkout') patchAtt({ outAt: null })
            if (r.ok && r.autoCheckout) { patchAtt({ outAt: r.autoCheckout.at }); notify('notice.autoCheckout') }
          }
          // nettoyage des photos des actions terminées
          for (const id of out.removed) {
            const it = toSend.find(x => x.id === id)
            for (const cid of it?.proofClientIds ?? []) { memProofs.current.delete(cid); try { await st?.proofDel(cid) } catch { /* ignoré */ } }
          }
          for (const n of out.notices) notify(n.code === 'BAD_STATE' ? 'notice.alreadyUpdated' : errorKey(n.code))
          const postponedOk = results.some(r => r.ok && toSend.find(x => x.id === r.id)?.type === 'postpone')
          if (postponedOk) notify('notice.postponed')
          else if (out.removed.length && !out.notices.length) notify('notice.sent')
          await refreshOrders()
          setLastSync(new Date().toISOString())
          return
        }
      }
      // file vide : simple rafraîchissement
      if (await refreshOrders()) setLastSync(new Date().toISOString())
    } finally { syncLock.current = false; setSyncing(false) }
  }, [api, notify, patchAtt, persistQueue, refreshOrders, sendPostpone, uploadProof])

  /** Enregistre une action (et ses photos) dans la file locale, puis tente l'envoi. Ne perd jamais l'action. */
  const enqueue = useCallback(async (a: { type: ActionType; orderId?: string; otp?: string; reason?: string; reasonCode?: string; geo?: Geo; photos?: { dataBase64: string; mime: string }[]; kind?: 'delivery' | 'noshow' | 'damage' }) => {
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
      otp: a.otp?.trim() || undefined, reason: a.reason?.trim() || undefined, reasonCode: a.reasonCode || undefined,
      proofClientIds: proofIds.length ? proofIds : undefined, tries: 0, state: 'pending',
    }
    await persistQueue([...queueRef.current, item])
    if (a.type === 'checkin') patchAtt({ inAt: at })
    else if (a.type === 'checkout') patchAtt({ outAt: at })
    if (navigator.onLine) void runSync()
  }, [patchAtt, persistQueue, runSync])

  const reenterOtp = useCallback(async (id: string, otp: string) => {
    const next = retryWithOtp(queueRef.current, id, otp)
    if (next !== queueRef.current) { await persistQueue(next); if (navigator.onLine) void runSync() }
  }, [persistQueue, runSync])

  /** Action refusée pour un motif levable (hors rayon, arrivée manquante, chargement incomplet) : nouvelle position puis renvoi, MÊME identifiant. */
  const retryItem = useCallback(async (id: string) => {
    const it = queueRef.current.find(q => q.id === id)
    if (!it || it.state !== 'error') return
    const geo = await getGeo(8000)
    const next = queueRef.current.map(q => (q.id === id ? { ...q, geo: geo ?? q.geo, state: 'pending' as const, errorCode: undefined } : q))
    await persistQueue(next)
    if (it.type === 'checkin') patchAtt({ inAt: it.at })
    if (navigator.onLine) void runSync()
  }, [patchAtt, persistQueue, runSync])

  const discard = useCallback(async (id: string) => {
    const it = queueRef.current.find(q => q.id === id)
    if (!it) return
    await persistQueue(queueRef.current.filter(q => q.id !== id), [id])
    for (const cid of it.proofClientIds ?? []) { memProofs.current.delete(cid); try { await storeRef.current?.proofDel(cid) } catch { /* ignoré */ } }
  }, [persistQueue])

  // ───────── scan d'un bac (réseau requis) ─────────
  const scan = useCallback(async (raw: string): Promise<ScanOutcome> => {
    const barcode = cleanBarcode(raw)
    if (!barcode) return { ok: false, code: 'BAD_BARCODE' }
    if (!navigator.onLine || !tokenRef.current) return { ok: false, code: 'NETWORK' }
    const geo = await getGeo(2500)
    try {
      const r = await api('/api/driver/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: newId(), barcode, geo }) })
      if (!r.ok) return { ok: false, code: r.status === 429 ? 'RATE' : 'NETWORK' }
      const j = (await r.json()) as { ok: boolean; code?: string; matched?: { label: string }; overview?: LoadOverview; checkin?: { done: boolean; code?: string; attendance?: { checkIn?: string | null } } }
      if (j.overview) setLoad(l => ({ ...j.overview!, required: l?.required }))
      if (j.checkin?.done && j.checkin.attendance?.checkIn) patchAtt({ inAt: j.checkin.attendance.checkIn })
      return { ok: j.ok, code: j.code, label: j.matched?.label, checkin: j.checkin ? { done: j.checkin.done, code: j.checkin.code } : undefined }
    } catch { setReachable(false); return { ok: false, code: 'NETWORK' } }
  }, [api, patchAtt])

  // ───────── compteur et carburant (réseau requis) ─────────
  const submitOdometer = useCallback(async (kind: 'start' | 'end', value: number): Promise<{ ok: boolean; code?: string }> => {
    if (!navigator.onLine) return { ok: false, code: 'NETWORK' }
    try {
      const r = await api('/api/driver/odometer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: newId(), kind, km: value }) })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string }
      if (!r.ok || !j.ok) return { ok: false, code: j.code ?? 'UNKNOWN' }
      const cur: KmDay = (() => { try { const p = JSON.parse(ls.get(KM_KEY) ?? 'null') as KmDay | null; return p?.day === todayKey() ? p : { day: todayKey() } } catch { return { day: todayKey() } } })()
      const next = { ...cur, [kind]: value }
      ls.set(KM_KEY, JSON.stringify(next)); setKm(next)
      return { ok: true }
    } catch { setReachable(false); return { ok: false, code: 'NETWORK' } }
  }, [api])

  const submitFuel = useCallback(async (liters: number, amount: number): Promise<{ ok: boolean; code?: string }> => {
    if (!navigator.onLine) return { ok: false, code: 'NETWORK' }
    try {
      const r = await api('/api/driver/fuel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: newId(), liters, amount }) })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string }
      return r.ok && j.ok ? { ok: true } : { ok: false, code: j.code ?? 'UNKNOWN' }
    } catch { setReachable(false); return { ok: false, code: 'NETWORK' } }
  }, [api])

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
      try { const p = JSON.parse(ls.get(KM_KEY) ?? 'null') as KmDay | null; if (p?.day === todayKey()) setKm(p) } catch { /* ignoré */ }
      try { const p = JSON.parse(ls.get(REASONS_KEY) ?? 'null') as DriverReason[] | null; if (Array.isArray(p) && p.length) { setReasons(p); setReasonsLive(true) } } catch { /* ignoré */ }

      const st = await openStore()
      if (dead) return
      storeRef.current = st; setStoreMode(st.mode)
      const [q, snap, pts] = await Promise.all([st.queueAll().catch(() => [] as QueueItem[]), st.snapGet().catch(() => null), st.posGet().catch(() => [] as StoredPoint[])])
      posRef.current = pts; setGpsPending(pts.length)
      // un envoi interrompu (état 'sending') est rejoué avec le même id
      const qq = q.map(x => (x.state === 'sending' ? { ...x, state: 'pending' as const } : x))
      setQ(qq)
      if (snap) {
        setOrders(snap.orders ?? [])
        if (snap.tour) { setTour(snap.tour); tourIdRef.current = snap.tour.tour?.id ?? null }
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
    const on = () => { setBrowserOnline(true); void runSync(); void flushPositions() }
    const off = () => setBrowserOnline(false)
    const vis = () => { if (!document.hidden) void runSync() }
    window.addEventListener('online', on); window.addEventListener('offline', off); document.addEventListener('visibilitychange', vis)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', vis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ───────── suivi GPS (uniquement application ouverte : une PWA ne peut pas suivre écran verrouillé) ─────────
  const persistPoints = useCallback(() => { setGpsPending(posRef.current.length); void storeRef.current?.posSet(posRef.current).catch(() => { /* mémoire seulement */ }) }, [])

  /** Envoie les positions en attente par lots de 200 ; un lot n'est retiré qu'après réponse OK (le serveur ignore les doublons). */
  const flushPositions = useCallback(async () => {
    if (posLock.current || !tokenRef.current || !navigator.onLine) return
    posLock.current = true
    try {
      for (let n = 0; n < 5 && posRef.current.length; n++) {
        const batch = posRef.current.slice(0, POINTS_PER_CALL)
        const r = await api('/api/driver/positions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points: batch, tourId: tourIdRef.current ?? undefined }) })
        if (!r.ok) { if (r.status === 400 || r.status === 413) { posRef.current = posRef.current.slice(batch.length); persistPoints() } break }
        posRef.current = posRef.current.slice(batch.length); persistPoints()
      }
    } catch { setReachable(false) } finally { posLock.current = false }
  }, [api, persistPoints])

  // tournée « en cours » : tournée en chargement / en cours, ou une commande en route / en livraison
  const tracking = auth === 'ok' && (
    (tour.tour != null && (tour.tour.status === 'ONGOING' || tour.tour.status === 'LOADING')) ||
    view.some(o => o.status === 'IN_TRANSPORT' || o.status === 'START_DELIVERY')
  )

  useEffect(() => {
    if (!tracking || typeof navigator === 'undefined' || !navigator.geolocation) { setGps('off'); return }
    let last: TrackPoint | null = null
    let wl: WakeLockLike | null = null
    const lockScreen = async () => { try { wl = (await (navigator as NavWithWakeLock).wakeLock?.request('screen')) ?? null } catch { wl = null } }
    void lockScreen()
    const onVis = () => { if (!document.hidden) void lockScreen() }
    document.addEventListener('visibilitychange', onVis)
    const id = navigator.geolocation.watchPosition(
      p => {
        setGps('active')
        const pt: TrackPoint = { lat: p.coords.latitude, lng: p.coords.longitude, at: p.timestamp || Date.now() }
        if (p.coords.accuracy > MAX_POINT_ACCURACY_M || !shouldKeepPoint(last, pt)) return
        last = pt
        posRef.current = [...posRef.current, {
          lat: pt.lat, lng: pt.lng, accuracy: Math.round(p.coords.accuracy), speed: p.coords.speed != null && p.coords.speed >= 0 ? Math.round(p.coords.speed * 10) / 10 : null, at: new Date(pt.at).toISOString(),
        }].slice(-MAX_BUFFERED_POINTS)
        persistPoints()
        if (posRef.current.length >= 20) void flushPositions()
      },
      err => { if (err.code === err.PERMISSION_DENIED) setGps('denied') },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    )
    const flushTimer = setInterval(() => { void flushPositions() }, 60_000)
    return () => {
      navigator.geolocation.clearWatch(id); clearInterval(flushTimer)
      document.removeEventListener('visibilitychange', onVis)
      void wl?.release().catch(() => { /* déjà libéré */ })
      setGps('off'); void flushPositions()
    }
  }, [tracking, persistPoints, flushPositions])

  return {
    auth, me, config, lang, setLang, view, queue, online, syncing, lastSync, notices, dismiss, storeMode, firstLoadFailed, att, pending: pend,
    tour, load, reasons, reasonsLive, gps, gpsPending, km,
    enqueue, runSync, reenterOtp, retryItem, discard, scan, refreshLoad, submitOdometer, submitFuel,
    retryAuth: async () => { setAuth('loading'); const ok = await loadMe(); if (ok) await runSync(); else setAuth(a => (a === 'loading' ? 'config' : a)) },
  }
}
