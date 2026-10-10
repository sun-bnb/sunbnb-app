import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { SUPPORTED_LOCALES, type Locale } from '@/lib/places.ts'

/**
 * Locale without URL prefixes, same convention as the other apps: NEXT_LOCALE cookie first, then
 * the browser's Accept-Language, then English. Ad links can force one with `?lang=` (handled by
 * the language switcher setting the cookie).
 */
function fromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=')
      return { lang: (tag ?? '').split('-')[0]!.toLowerCase(), q: q ? Number(q) : 1 }
    })
    .sort((a, b) => b.q - a.q)
  return (ranked.find((r) => SUPPORTED_LOCALES.includes(r.lang as Locale))?.lang as Locale) ?? null
}

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value as Locale | undefined
  const locale: Locale =
    (cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale) ? cookieLocale : null) ??
    fromAcceptLanguage((await headers()).get('accept-language')) ??
    'en'
  return { locale, messages: (await import(`../messages/${locale}.json`)).default }
})
