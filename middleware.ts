import { NextRequest, NextResponse } from 'next/server'

// ─── Next.js Edge Middleware — Auth guard ─────────────────────────────────────
// Runs on Edge (no DB access). Cookie presence is checked here.
// Full DB session validation happens inside API routes via lib/auth.ts.

const COOKIE_NAME = 'shipinfy_session'

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/bootstrap',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow Next.js internals and static assets
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

  const hasSession = Boolean(req.cookies.get(COOKIE_NAME)?.value)

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
