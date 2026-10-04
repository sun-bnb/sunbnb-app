import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import BeachMap from '@/components/BeachMap'
import { SiteFooter, SiteHeader } from '@/components/SiteChrome'
import { fetchBeachPlace } from '@/lib/place-details.ts'
import { isValidSessionToken, localeOrDefault, parseBeachParams } from '@/lib/places.ts'

export const dynamic = 'force-dynamic'

/**
 * /beach?place=…&beds=… — the prospect's beach on the satellite map with a generated sunbed
 * layout (P2) they can turn and move. The booking demo (P3) renders on this same map.
 */
export default async function BeachPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const t = await getTranslations('Beach')
  const parsed = parseBeachParams(searchParams)
  const session = typeof searchParams.s === 'string' && isValidSessionToken(searchParams.s) ? searchParams.s : undefined
  const place = parsed ? await fetchBeachPlace(parsed.placeId, { session, lang: localeOrDefault(await getLocale()) }) : null

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {!parsed || !place ? (
          <div className="py-16 text-center">
            <p className="text-sm text-gray-600">{t('notFound')}</p>
            <Link href="/" className="btn-primary mt-4 inline-block">
              {t('change')}
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{place.name}</h1>
                <p className="text-sm text-gray-500">
                  {place.address} · {t('sunbeds', { count: parsed.sunbedCount })}
                </p>
              </div>
              <Link href="/" className="btn-ghost">
                {t('change')}
              </Link>
            </div>
            {/* Client key only — never fall back to the server key, which would ship it in the HTML. */}
            <BeachMap
              apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY ?? ''}
              center={{ lat: place.lat, lng: place.lng }}
              sunbedCount={parsed.sunbedCount}
            />
          </>
        )}
      </main>
      <SiteFooter />
    </>
  )
}
