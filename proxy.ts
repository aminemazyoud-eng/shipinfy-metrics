import { NextRequest, NextResponse } from 'next/server'
import { canAccess } from '@/lib/permissions'

// ─── Edge-compatible proxy (Next.js 16 convention: proxy.ts = middleware) ────
// Full DB session validation is done inside each API route via lib/auth.ts
// Proxy checks cookie presence + role-based route access (no DB — Edge runtime)

const COOKIE_NAME = 'shipinfy_session'
const ROLE_COOKIE = 'shipinfy_role'

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/bootstrap',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/health', // healthcheck public (aucune donnée sensible)
  '/api/webhooks/n8n', // callback n8n : la route vérifie elle-même une signature HMAC
  '/api/planning/pdf', // lien signé du planning envoyé par WhatsApp (jeton HMAC par jour + chauffeur)
  '/api/track', // suivi client : lien signé HMAC (jeton par commande, expire 48 h après le créneau)
  '/suivi', // page publique de suivi client (/suivi/[token])
]

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  const isApi = pathname.startsWith('/api/')

  // Internes Next.js et fichiers de public/ uniquement — le contournement ne s'applique JAMAIS sous /api/
  if (
    !isApi && (
      pathname.startsWith('/_next') ||
      pathname.startsWith('/favicon') ||
      /\.(png|jpg|jpeg|gif|svg|ico|css|js|woff2?|html)$/.test(pathname)
    )
  ) {
    return NextResponse.next()
  }

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const hasSession = Boolean(
    req.cookies.get(COOKIE_NAME)?.value ??
    req.headers.get('Authorization')
  )

  if (!hasSession) {
    // API : réponse JSON 401 (pas de redirection vers /login)
    if (isApi) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Routage UI par rôle (cookie shipinfy_role = confort d'affichage, PAS une preuve d'identité) ; les routes API font leur propre garde
  if (!isApi) {
    const role = req.cookies.get(ROLE_COOKIE)?.value
    if (role && !canAccess(role, pathname)) {
      return NextResponse.redirect(new URL('/', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|logo\\.png).*)'],
}
