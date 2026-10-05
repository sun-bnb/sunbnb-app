import { getLocale, getTranslations } from 'next-intl/server'
import { parseAngle } from '@repo/data/lead-model'
import Experience from '@/components/Experience'
import { SiteFooter, SiteHeader } from '@/components/SiteChrome'
import TrackOnMount from '@/components/TrackOnMount'
import { offerFor } from '@/lib/offer.ts'
import { localeOrDefault } from '@/lib/places.ts'

/**
 * try.sunbnb.app — the ad landing page (track 027). Every claim here must be TRUE TODAY:
 * features are shipped ones, and the price line reads the same catalog billing is seeded from.
 */
export default async function LandingPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const t = await getTranslations()
  // Ad scent: the headline repeats the promise of the ad that brought them (`?a=` angle key).
  // Only fixed copy keys are ever rendered — never text from the query string.
  const angle = parseAngle(searchParams.a)
  const title = angle ? t(`Hero.angles.${angle}.title`) : t('Hero.title')
  const subtitle = angle ? t(`Hero.angles.${angle}.subtitle`) : t('Hero.subtitle')
  const offer = offerFor(localeOrDefault(await getLocale()))
  const facts = [
    { title: t('Facts.f1Title'), body: t('Facts.f1'), icon: <MapIcon /> },
    { title: t('Facts.f2Title'), body: t('Facts.f2'), icon: <QrIcon /> },
    { title: t('Facts.f3Title'), body: t('Facts.f3'), icon: <DeviceIcon /> },
  ]

  return (
    <>
      <TrackOnMount name="landing_view" context={{ angle }} />
      <main className="relative bg-[#fff5e1]">
        <SiteHeader overlay />
        <Experience
          title={title}
          subtitle={subtitle}
          offer={offer}
          angle={angle}
          chatEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
          apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY ?? ''}
        />

        <section className="mx-auto grid max-w-6xl gap-8 px-4 pb-16 pt-4 sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.title}>
              <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00cef1]/15 text-[#0083a0]">{f.icon}</div>
              <h2 className="text-base font-semibold text-[#0e3a4a]">{f.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-[#0e3a4a]/70">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
      <SiteFooter />
    </>
  )
}

const iconProps = { className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true } as const

function MapIcon() {
  return (
    <svg {...iconProps}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
    </svg>
  )
}

function QrIcon() {
  return (
    <svg {...iconProps}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
    </svg>
  )
}

function DeviceIcon() {
  return (
    <svg {...iconProps}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
    </svg>
  )
}
