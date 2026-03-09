import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Admin app middleware — defence-in-depth auth gate.
 *
 * All pages and server-side routes already check auth + sudo individually,
 * but this middleware acts as a first-line guard to redirect unauthenticated
 * requests before they hit any page component.
 *
 * Checks for a NextAuth session token cookie. If absent, redirects to /sign-in.
 * Public routes (sign-in, password reset, auth API, health check) are excluded.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public routes through without auth check
  if (
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/logo.ico' ||
    pathname === '/logo-lila.png'
  ) {
    return NextResponse.next()
  }

  // Check for NextAuth session token (works for both secure and non-secure cookies)
  const token =
    req.cookies.get('__Secure-authjs.session-token') ||
    req.cookies.get('authjs.session-token') ||
    req.cookies.get('__Secure-next-auth.session-token') ||
    req.cookies.get('next-auth.session-token')

  if (!token) {
    const signInUrl = new URL('/sign-in', req.url)
    signInUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(signInUrl)
  }

  return NextResponse.next()
}

export const config = {
  // Match all routes except static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
