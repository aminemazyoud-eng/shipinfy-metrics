import { NextRequest, NextResponse } from 'next/server'

// ─── Edge-compatible proxy (Next.js 16 — renamed from middleware.ts) ─────────
// Full DB session validation is done inside each API route via lib/auth.ts
// Proxy only handles redirects (no DB access — Edge runtime)

const COOKIE_NAME   = 'shipinfy_session'
const PUBLIC_ROUTES = ['/login', '/api/auth/login', '/api/auth/bootstrap']
const ADMIN_PAGES   = ['/admin']  // page routes that require SUPER_ADMIN

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow public routes and Next.js internals
  if (
    PUBLIC_ROUTES.some(r => pathname.startsWith(r)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    /\.(png|jpg|jpeg|gif|svg|ico|css|js|woff2?)$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  const hasSession = Boolean(
    req.cookies.get(COOKIE_NAME)?.value ??
    req.headers.get('Authorization')
  )

  // Guard admin PAGES — redirect to /login if no session cookie
  // (API routes /api/admin/* do full DB validation inside the route)
  if (ADMIN_PAGES.some(r => pathname === r || pathname.startsWith(r + '/')) && !hasSession) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|logo\\.png).*)',
  ],
}
