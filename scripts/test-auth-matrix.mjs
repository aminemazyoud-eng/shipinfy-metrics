// scripts/test-auth-matrix.mjs — Sprint 17 A3 : vérifie statiquement que chaque route /api expose une garde.
// Usage : npm run test:auth   (exit 1 si une route est ouverte)
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(process.cwd(), 'app', 'api')
const GUARD = /requireSession|getSession|opsAuth|verifyPlan|createHmac|timingSafeEqual|driverFromRequest/ // driverFromRequest : jeton HMAC par livreur (application livreur, lib/ops-driver-token.ts)
// Routes volontairement publiques (la sécurité est portée par la route elle-même : login, lien signé, signature HMAC…)
const WHITELIST = new Set([
  'auth/login', 'auth/logout', 'auth/bootstrap', 'auth/forgot-password', 'auth/reset-password',
  'planning/pdf', 'webhooks/n8n',
  'track/[token]', 'track/[token]/rating', // suivi client : jeton HMAC signé (expire 48 h après le créneau), données minimales
  'driver/ping', // application livreur : détection de connexion, aucune donnée, limité par IP (les autres routes /api/driver/* exigent le jeton HMAC par livreur)
  'health', // healthcheck public sans donnée sensible (Docker / Dokploy)
])

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : e.name === 'route.ts' ? [p] : []
  })
}

let open = 0, ok = 0, white = 0
for (const file of walk(ROOT).sort()) {
  const rel = path.relative(ROOT, path.dirname(file)).split(path.sep).join('/')
  const src = fs.readFileSync(file, 'utf8')
  const methods = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map(m => m[1] ?? m[2])
  if (!methods.length) continue
  if (WHITELIST.has(rel)) { white++; console.log(`  LISTE BLANCHE  ${methods.join(',').padEnd(22)} /api/${rel}`); continue }
  // Garde par méthode : chaque corps de handler doit contenir une garde (ou le fichier en avoir une dans l'appel d'un helper partagé)
  const parts = src.split(/export\s+(?:async\s+)?function\s+(?=GET|POST|PUT|PATCH|DELETE\b)/).slice(1)
  const unguarded = parts.map(p => ({ m: p.match(/^[A-Z]+/)[0], body: p })).filter(h => !GUARD.test(h.body)).map(h => h.m)
  if (unguarded.length || !GUARD.test(src)) { open++; console.log(`  OUVERTE        ${(unguarded.join(',') || methods.join(',')).padEnd(22)} /api/${rel}`) }
  else { ok++; console.log(`  ok             ${methods.join(',').padEnd(22)} /api/${rel}`) }
}
console.log(`\nRoutes gardées : ${ok} · liste blanche : ${white} · ouvertes : ${open}`)
if (open) { console.error('ÉCHEC — des routes /api sont sans garde d\'authentification.'); process.exit(1) }
console.log('OK — aucune route ouverte.')
