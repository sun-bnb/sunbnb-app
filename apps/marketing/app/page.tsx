import { getLocale, getTranslations } from 'next-intl/server'
import { parseAngle } from '@repo/data/lead-model'
import { PRICING_TIERS } from '@repo/data/pricing-tiers'
import BeachTour from '@/components/BeachTour'
import DeviceShowcase from '@/components/DeviceShowcase'
import Experience from '@/components/Experience'
import { SiteFooter, SiteHeader } from '@/components/SiteChrome'
import ReadingTracker from '@/components/ReadingTracker'
import TrackOnMount from '@/components/TrackOnMount'
import { offerFor } from '@/lib/offer.ts'
import { localeOrDefault } from '@/lib/places.ts'

/**
 * try.sunbnb.app — the ad landing page (track 027). Every claim here must be TRUE TODAY:
 * features are shipped ones, and the price line reads the same catalog billing is seeded from.
 */
export default async function LandingPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const searchParams = await searchParamsPromise
  const t = await getTranslations()
  // Ad scent: the headline repeats the promise of the ad that brought them (`?a=` angle key).
  // Only fixed copy keys are ever rendered — never text from the query string.
  const angle = parseAngle(searchParams.a)
  const title = angle ? t(`Hero.angles.${angle}.title`) : t('Hero.title')
  const subtitle = angle ? t(`Hero.angles.${angle}.subtitle`) : t('Hero.subtitle')
  const offer = offerFor(localeOrDefault(await getLocale()))
  const tourTags = {
    book: t('Hero.sceneTag'),
    device: t('Hero.slides.device.tag'),
    order: t('Hero.slides.order.tag'),
    rent: t('Hero.slides.rent.tag'),
    checkin: t('Hero.slides.checkin.tag'),
    invoice: t('Hero.slides.invoice.tag'),
  }
  const starter = PRICING_TIERS.STARTER
  const faq = [
    ['noPhone', {}],
    ['hardware', {}],
    ['paid', {}],
    ['cost', { pct: starter.commissionPercent, pro: PRICING_TIERS.PRO.commissionPercent, business: PRICING_TIERS.BUSINESS.commissionPercent }],
    ['languages', {}],
  ] as const

  return (
    <>
      <TrackOnMount name="landing_view" context={{ angle }} />
      <ReadingTracker />
      <main className="relative bg-sand">
        <SiteHeader overlay />
        <Experience
          title={title}
          subtitle={subtitle}
          offer={offer}
          angle={angle}
          chatEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
          apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY ?? ''}
        />

        <BeachTour tags={tourTags} />

        <DeviceShowcase />

        <section data-track-section="start" className="mx-auto max-w-3xl px-4 py-16">
          <h2 className="text-3xl font-semibold tracking-tight text-[#0e3a4a]">{t('Start.title')}</h2>
          <ol className="mt-6 space-y-4">
            {(['s1', 's2', 's3'] as const).map((k, i) => (
              <li key={k} className="flex gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-[#0e3a4a] bg-[#00cef1] text-sm font-bold text-[#0e3a4a]">{i + 1}</span>
                <div>
                  <h3 className="text-lg font-semibold text-[#0e3a4a]">{t(`Start.${k}Title`)}</h3>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-[#0e3a4a]/70">{t(`Start.${k}`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section data-track-section="faq" className="mx-auto max-w-3xl px-4 pb-20">
          <h2 className="text-3xl font-semibold tracking-tight text-[#0e3a4a]">{t('Faq.title')}</h2>
          <div className="mt-6 divide-y divide-[#0e3a4a]/10 rounded-3xl border-2 border-[#0e3a4a] bg-white">
            {faq.map(([k, params]) => (
              <details key={k} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-[#0e3a4a]">
                  {t(`Faq.${k}Q`)}
                  <span className="text-xl leading-none text-[#0083a0] transition group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-2 text-[15px] leading-relaxed text-[#0e3a4a]/75">{t(`Faq.${k}A`, params)}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
