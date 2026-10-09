/**
 * lib/ops-cache.ts — cache mémoire « single-flight » à TTL court (Sprint 17 C4, Annexe C §3.2).
 * 20 onglets qui interrogent la même route en même temps = UNE seule requête SQL ; les appels concurrents partagent la promesse en cours.
 * `bumpOpsEpoch()` invalide tout (à appeler après synchro / assignation / encaissement). Cache par processus : suffisant pour une instance.
 */
interface Entry { epoch: number; exp: number; value?: unknown; promise?: Promise<unknown> }
const g = globalThis as unknown as { __opsCache?: { epoch: number; map: Map<string, Entry> } }
const store = (g.__opsCache ??= { epoch: 0, map: new Map<string, Entry>() })
const MAX_ENTRIES = 500

export function bumpOpsEpoch(): number { store.epoch++; store.map.clear(); return store.epoch }
export const opsEpoch = () => store.epoch

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now(), hit = store.map.get(key)
  if (hit && hit.epoch === store.epoch) {
    if (hit.promise) return hit.promise as Promise<T>
    if (hit.exp > now) return hit.value as T
  }
  if (store.map.size >= MAX_ENTRIES) {
    for (const [k, e] of store.map) if (!e.promise && e.exp <= now) store.map.delete(k)
    if (store.map.size >= MAX_ENTRIES) store.map.clear()
  }
  const epoch = store.epoch
  const promise: Promise<T> = fn().then(
    v => {
      const cur = store.map.get(key)
      if (cur?.promise === promise) { if (store.epoch === epoch) store.map.set(key, { epoch, exp: Date.now() + ttlMs, value: v }); else store.map.delete(key) }
      return v
    },
    e => { if (store.map.get(key)?.promise === promise) store.map.delete(key); throw e }, // une erreur n'est jamais mise en cache
  )
  store.map.set(key, { epoch, exp: 0, promise })
  return promise
}
