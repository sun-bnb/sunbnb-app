import { NextResponse, type NextRequest } from 'next/server'
import { ROUTE_LOCALE_HEADER } from '@/lib/locale.ts'
import { CONTENT_LOCALE } from '@/lib/content-pages.ts'

/**
 * Content pages are Spanish by URL (CR-003): stamp the route language on the request so
 * i18n/request.ts renders them — and the root layout's <html lang> — in Spanish regardless of the
 * NEXT_LOCALE cookie or Accept-Language. Never redirects by language.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.set(ROUTE_LOCALE_HEADER, CONTENT_LOCALE)
  return NextResponse.next({ request: { headers } })
}

export const config = { matcher: ['/guias/:path*', '/es/:path*'] }
