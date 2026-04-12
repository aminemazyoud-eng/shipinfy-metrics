import { NextRequest, NextResponse } from 'next/server'

// ─── Edge-compatible proxy (Next.js 16 convention: proxy.ts = middleware) ────
// Full DB session validation is done inside each API route via lib/auth.ts
// Proxy only checks cookie presence (no DB access — Edge runtime)

const COOKIE_NAME = 'shipinfy_session'

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

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|logo\\.png).*)'],
}
