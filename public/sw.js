/* Service worker de l'application livreur (/livreur).
 * - Met en cache la « coquille » : page /livreur, assets /_next/static, manifeste, logo, icônes (stale-while-revalidate).
 * - /api/** : JAMAIS intercepté ni mis en cache (les données hors ligne vivent dans IndexedDB).
 * - N'intercepte rien d'autre (ni /suivi, ni le reste de l'application).
 */
const VERSION = 'v1'
const CACHE = 'shipinfy-driver-' + VERSION
const SHELL = ['/livreur', '/manifest.webmanifest', '/logo.png']

const OFFLINE_HTML = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hors ligne</title>' +
  '<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}button{margin-top:16px;font-size:18px;padding:14px 24px;border:0;border-radius:14px;background:#2563eb;color:#fff}</style></head>' +
  '<body><div><h1>Hors ligne / غير متصل</h1><p>Ouvrez une première fois l’application avec Internet pour l’utiliser sans réseau.<br>افتح التطبيق مرة أولى مع الإنترنت لاستعماله دون اتصال.</p><button onclick="location.reload()">Réessayer / إعادة المحاولة</button></div></body></html>'

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await Promise.all(SHELL.map(async u => { try { await cache.add(new Request(u, { cache: 'reload' })) } catch (e) { /* hors ligne à l'installation : ignoré */ } }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k.startsWith('shipinfy-driver-') && k !== CACHE).map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

// La page envoie la liste des assets déjà chargés avant l'enregistrement du SW, pour les rendre disponibles hors ligne.
self.addEventListener('message', event => {
  const d = event.data
  if (!d || d.type !== 'CACHE_URLS' || !Array.isArray(d.urls)) return
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await Promise.all(d.urls.filter(shouldCacheAsset).map(async u => {
      try { if (!(await cache.match(u))) await cache.add(u) } catch (e) { /* ignoré */ }
    }))
  })())
})

function shouldCacheAsset(u) {
  try {
    const url = new URL(u, self.location.origin)
    if (url.origin !== self.location.origin) return false
    const p = url.pathname
    return p.startsWith('/_next/static/') || p === '/manifest.webmanifest' || p === '/logo.png' || p.startsWith('/icons/')
  } catch (e) { return false }
}

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  const p = url.pathname
  if (p.startsWith('/api/')) return // network-only : on ne touche pas

  // Navigation vers /livreur (le jeton ?t= n'est jamais mis en clé de cache)
  if (req.mode === 'navigate') {
    if (p !== '/livreur' && !p.startsWith('/livreur/')) return
    event.respondWith(navigate(req))
    return
  }
  if (shouldCacheAsset(req.url)) event.respondWith(staleWhileRevalidate(req))
})

async function navigate(req) {
  const cache = await caches.open(CACHE)
  const key = '/livreur'
  const cached = await cache.match(key)
  const net = fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(key, res.clone())
    return res
  })
  if (cached) { net.catch(() => {}); return cached } // coquille immédiate, mise à jour en arrière-plan
  try { return await net } catch (e) {
    return new Response(OFFLINE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(req)
  const net = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone())
    return res
  })
  if (cached) { net.catch(() => {}); return cached }
  try { return await net } catch (e) { return Response.error() }
}
