import { getRequestConfig } from 'next-intl/server'
import { headers } from 'next/headers'
 
export default getRequestConfig(async ({ requestLocale }) => {

  // Provide a static locale, fetch a user setting,
  // read from `cookies()`, `headers()`, etc.

  let locale = 'en'

  const nextlIntLocale = await requestLocale
  console.log('nextlIntLocale', nextlIntLocale)
  if (!nextlIntLocale) {
    const headersList = await headers()
    const acceptLanguage = headersList.get('accept-language')
    console.log('acceptLanguage', acceptLanguage)
    if (acceptLanguage) {
      const language = acceptLanguage.split(',')[0]?.substring(0, 2)
      console.log('language', language)
      locale = language || locale
    }
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  }

})