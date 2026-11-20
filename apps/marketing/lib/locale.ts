/**
 * Page-language resolution (i18n/request.ts). No URL prefixes for the landing, same convention as
 * the other apps: NEXT_LOCALE cookie, then Accept-Language, then English. Content pages
 * (/guias/*, /es/*) carry their language in the route instead: `proxy.ts` stamps
 * ROUTE_LOCALE_HEADER on those requests and it wins over cookie and browser, so a crawler and a
 * visitor with an English cookie both get the Spanish page at its Spanish URL.
 *
 * A client can send the header itself on other paths; that only picks its own page language,
 * which the cookie already allows, so it is not trusted for anything else.
 */
import { SUPPORTED_LOCALES, type Locale } from './places.ts'

export const ROUTE_LOCALE_HEADER = 'x-sunbnb-route-locale'

function supported(value: string | null | undefined): Locale | null {
  return value && (SUPPORTED_LOCALES as readonly string[]).includes(value) ? (value as Locale) : null
}

export function fromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=')
      return { lang: (tag ?? '').split('-')[0]!.toLowerCase(), q: q ? Number(q) : 1 }
    })
    .sort((a, b) => b.q - a.q)
  return ranked.map((r) => supported(r.lang)).find(Boolean) ?? null
}

export function resolveLocale(input: { routeLocale?: string | null; cookie?: string | null; acceptLanguage?: string | null }): Locale {
  return supported(input.routeLocale) ?? supported(input.cookie) ?? fromAcceptLanguage(input.acceptLanguage ?? null) ?? 'en'
}
