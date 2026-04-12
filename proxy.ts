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
]

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow Next.js internals and static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    /\.(png|jpg|jpeg|gif|svg|ico|css|js|woff2?)$/.test(pathname)
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
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Role-based route protection (API routes do their own auth — skip them here)
  if (!pathname.startsWith('/api/')) {
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
