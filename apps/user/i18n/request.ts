import { getRequestConfig } from 'next-intl/server'
import { headers } from 'next/headers'

/**
 * Parses an Accept-Language string into an array of
 * { language: string, q: number } objects, sorted by highest q first.
 * 
 * Example:
 * "en-US,en;q=0.9,fi-FI;q=0.8,fi;q=0.7,ru-RU;q=0.6,ru;q=0.5"
 * -> [
 *   { language: 'en-US', q: 1 },
 *   { language: 'en', q: 0.9 },
 *   { language: 'fi-FI', q: 0.8 },
 *   { language: 'fi', q: 0.7 },
 *   { language: 'ru-RU', q: 0.6 },
 *   { language: 'ru', q: 0.5 }
 * ]
 */
export function parseAcceptLanguage(acceptLanguage: string): Array<{ language: string; q: number }> {
  if (!acceptLanguage) return [];

  return acceptLanguage
    // Split on commas: ["en-US", "en;q=0.9", "fi-FI;q=0.8", ...]
    .split(',')
    .map((part) => {
      const [lang, qPart] = part.trim().split(';');
      // If there's no q= fragment, default to 1
      let q = 1.0;
      if (qPart && qPart.trim().startsWith('q=')) {
        const qValue = qPart.trim().substring(2); // remove 'q='
        const parsed = parseFloat(qValue);
        if (!isNaN(parsed)) {
          q = parsed;
        }
      }
      return { language: lang!, q };
    })
    // Sort descending by q
    .sort((a, b) => b.q - a.q);
}

// Example usage:
const header = 'en-US,en;q=0.9,fi-FI;q=0.8,fi;q=0.7,ru-RU;q=0.6,ru;q=0.5';
const parsed = parseAcceptLanguage(header);
console.log(parsed);
/*
[
  { language: 'en-US', q: 1 },
  { language: 'en', q: 0.9 },
  { language: 'fi-FI', q: 0.8 },
  { language: 'fi', q: 0.7 },
  { language: 'ru-RU', q: 0.6 },
  { language: 'ru', q: 0.5 }
]
*/

// Then you can pick the top item:
const topLang = parsed[0]?.language; // "en-US"

 
export default getRequestConfig(async ({ requestLocale }) => {

  // Provide a static locale, fetch a user setting,
  // read from `cookies()`, `headers()`, etc.

  const availableLocales = ['en', 'es']

  let locale = 'en'

  const nextlIntLocale = await requestLocale
  console.log('nextlIntLocale', nextlIntLocale)
  if (!nextlIntLocale) {
    const headersList = await headers()
    const acceptLanguage = headersList.get('accept-language')
    if (acceptLanguage) {
      const acceptedLanguages = parseAcceptLanguage(acceptLanguage)
      console.log('acceptLanguages', acceptedLanguages)
      for (const { language } of acceptedLanguages) {
        // If you only care about the 2-letter code, parse it:
        const shortCode = language.split('-')[0];
        if (shortCode && availableLocales.includes(shortCode)) {
          locale = shortCode;
          break;
        }
      }
    }
  } else {
    locale = nextlIntLocale
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  }

})