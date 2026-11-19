import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { ROUTE_LOCALE_HEADER, resolveLocale } from '@/lib/locale.ts'

/**
 * Route language (content pages, via proxy.ts) → NEXT_LOCALE cookie → Accept-Language → English.
 * Rules and reasons: lib/locale.ts. There is no `?lang=` override: nothing reads that parameter.
 */
export default getRequestConfig(async () => {
  const h = await headers()
  const locale = resolveLocale({
    routeLocale: h.get(ROUTE_LOCALE_HEADER),
    cookie: (await cookies()).get('NEXT_LOCALE')?.value,
    acceptLanguage: h.get('accept-language'),
  })
  return { locale, messages: (await import(`../messages/${locale}.json`)).default }
})
