'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import sunbnbLogo from '@/app/sunbnb-logo.svg'
import { gaEvent } from '@repo/ui/google-analytics'
import { marketingCtaUrl } from '@/lib/marketing-cta'
import { PRICING_TIERS, PRICING_TIER_ORDER, FEATURED_TIER } from '@repo/data/pricing-tiers'

interface BusinessEntity {
  companyName: string
  companyAddress: string | null
  businessId: string | null
  vatId: string | null
  contactEmail: string | null
  contactPhone: string | null
}

/**
 * The partner front door (signed-out `/`). Every claim on it must be TRUE TODAY — the
 * verified source is the marketing agent's `apps/marketing/lib/agent/knowledge.ts`
 * (shipped vs coming vs not offered). Things that are easy to overclaim and are NOT true:
 * guest payments via Stripe (Mollie only), hourly sunbed booking, staff scanning the QR
 * pass (they search by name), card terminals, live Veri*factu, a native app.
 */

const mono = 'font-(family-name:--font-geist-mono)'

// The floor grid's own palette (`getCellAppearance` in @repo/floor-core) — the hero shows
// the beach the way staff actually see it, not a stock icon.
const SEAT = {
  free: 'bg-green-300 border-green-500',
  booked: 'bg-fuchsia-400 border-fuchsia-600',
  occupied: 'bg-red-400 border-red-600',
  comp: 'bg-sky-400 border-sky-600',
} as const
type Seat = keyof typeof SEAT

const F = 'free', B = 'booked', O = 'occupied', C = 'comp'
const BEACH: Seat[][] = [
  [O, O, B, F, B, B, O, F],
  [B, F, O, O, F, C, B, B],
  [F, B, B, F, F, O, F, B],
  [F, F, B, F, F, F, B, F],
]

/**
 * GA4: CTA clicks. Sign-up intent (hero / pricing / start) is a `generate_lead`; the nav sign-in
 * (mostly returning partners) and plain outbound links are `select_content`. `cta` names the spot.
 */
function trackCta(cta: string, event: 'generate_lead' | 'select_content' = 'select_content') {
  gaEvent(event, event === 'generate_lead' ? { cta } : { content_type: 'cta', content_id: cta, cta })
}

function SignInLink({
  className,
  children,
  cta,
  lead = true,
}: {
  className: string
  children: React.ReactNode
  cta: string
  lead?: boolean
}) {
  return (
    <Link href="/sign-in" className={className} onClick={() => trackCta(cta, lead ? 'generate_lead' : 'select_content')}>
      {children}
    </Link>
  )
}

function BeachGrid() {
  const t = useTranslations('Landing.hero')
  return (
    <figure className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs" aria-label={t('gridLabel')}>
      <div className="flex items-baseline justify-between border-b border-gray-100 pb-3">
        <span className="text-sm font-semibold text-gray-900">{t('gridTitle')}</span>
        <span className={`${mono} text-xs text-gray-400`}>{t('gridToday')}</span>
      </div>
      {/* The sea is at the top of the floor view, as on the manage page. */}
      <div className="mt-3 h-1.5 rounded-full bg-sky-100" aria-hidden />
      <div className="mt-3 space-y-1.5" aria-hidden>
        {BEACH.map((row, r) => (
          <div key={r} className="flex items-center gap-1.5">
            <span className={`${mono} w-4 text-[10px] text-gray-400`}>{r + 1}</span>
            {row.map((s, i) => (
              <span key={i} className={`h-6 flex-1 rounded-sm border-2 ${SEAT[s]}`} />
            ))}
          </div>
        ))}
      </div>
      <figcaption className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-500">
        {(Object.keys(SEAT) as Seat[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-xs border-2 ${SEAT[s]}`} aria-hidden />
            {t(`legend.${s}`)}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

export default function LandingPage({ businessEntity }: { businessEntity: BusinessEntity }) {
  const t = useTranslations('Landing')

  // The day, in the order it happens at a venue — not a feature grid.
  const day = [
    { time: t('day.setup.time'), title: t('day.setup.title'), body: t('day.setup.body') },
    { time: t('day.book.time'), title: t('day.book.title'), body: t('day.book.body') },
    { time: t('day.arrive.time'), title: t('day.arrive.title'), body: t('day.arrive.body') },
    { time: t('day.order.time'), title: t('day.order.title'), body: t('day.order.body') },
    { time: t('day.desk.time'), title: t('day.desk.title'), body: t('day.desk.body') },
    { time: t('day.close.time'), title: t('day.close.title'), body: t('day.close.body') },
  ]

  const more = (['rentals', 'tables', 'reports', 'staff', 'refunds', 'languages'] as const).map((k) => ({
    key: k,
    title: t(`more.${k}.title`),
    body: t(`more.${k}.body`),
  }))

  // Card copy per tier. The numbers — price, venue cap, commission — come from
  // PRICING_TIERS, the same catalog the DB is seeded from, so the page can't
  // advertise a rate the cascade doesn't charge. Only the wording is translated.
  const planFeatureLines = {
    STARTER: [t('plans.oneVenue'), t('plans.starterAll'), t('plans.supportCommunity')],
    PRO: [
      t('plans.upToVenues', { count: PRICING_TIERS.PRO.maxSites }),
      t('plans.everythingIn', { plan: PRICING_TIERS.STARTER.name }),
      t('plans.offPlatform'),
      t('plans.supportPriority'),
    ],
    BUSINESS: [
      t('plans.upToVenues', { count: PRICING_TIERS.BUSINESS.maxSites }),
      t('plans.everythingIn', { plan: PRICING_TIERS.PRO.name }),
      t('plans.branded'),
      t('plans.supportDedicated'),
    ],
  } as const

  const commissionRates = {
    starter: PRICING_TIERS.STARTER.commissionPercent,
    pro: PRICING_TIERS.PRO.commissionPercent,
    business: PRICING_TIERS.BUSINESS.commissionPercent,
  }

  const plans = PRICING_TIER_ORDER.map((tier) => {
    const spec = PRICING_TIERS[tier]
    return {
      tier,
      name: spec.name,
      price: spec.monthlyPrice === 0 ? t('plans.free') : `€${spec.monthlyPrice}`,
      note: spec.monthlyPrice === 0 ? t('plans.freeNote') : t('plans.perMonth'),
      commission: `${spec.commissionPercent}%`,
      featured: tier === FEATURED_TIER,
      features: planFeatureLines[tier],
    }
  })

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Nav */}
      <header className="border-b border-gray-200">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Image alt="Sunbnb" src={sunbnbLogo} className="h-7 w-7" />
            <span className="font-semibold tracking-tight">Sunbnb</span>
            <span className="ml-1 rounded-sm border border-gray-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              {t('nav.badge')}
            </span>
          </div>
          <SignInLink className="btn-ghost" cta="nav-sign-in" lead={false}>{t('nav.signIn')}</SignInLink>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-5xl items-center gap-12 px-6 pb-20 pt-16 md:grid-cols-[1.15fr_1fr] md:pt-24">
        <div>
          <p className="text-sm font-medium text-gray-500">{t('hero.eyebrow')}</p>
          <h1 className="mt-3 text-4xl font-bold leading-[1.1] tracking-tight md:text-5xl md:leading-none">
            <span className="block">{t('hero.title1')}</span>
            <span className="block text-gray-400">{t('hero.title2')}</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600">{t('hero.body')}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <SignInLink className="btn-primary px-5 py-2.5" cta="hero-sign-up">{t('hero.cta')}</SignInLink>
            <a href={marketingCtaUrl(process.env.NEXT_PUBLIC_MARKETING_URL)} onClick={() => trackCta('hero-see-your-beach')} className="btn-ghost underline underline-offset-4">
              {t('hero.seeYourBeach')}
            </a>
          </div>
          <p className="mt-6 text-sm text-gray-500">{t('hero.noHardware')}</p>
        </div>
        <BeachGrid />
      </section>

      {/* A day at the venue */}
      <section className="border-t border-gray-200">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-3xl font-bold tracking-tight">{t('day.title')}</h2>
          <p className="mt-2 max-w-2xl text-gray-600">{t('day.subtitle')}</p>
          <ol className="mt-10 divide-y divide-gray-200 border-y border-gray-200">
            {day.map((d) => (
              <li key={d.title} className="grid gap-1 py-6 md:grid-cols-[9rem_14rem_1fr] md:gap-6">
                <span className={`${mono} text-sm text-gray-400`}>{d.time}</span>
                <h3 className="font-semibold">{d.title}</h3>
                <p className="leading-relaxed text-gray-600">{d.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* More */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="text-2xl font-bold tracking-tight">{t('more.title')}</h2>
        <dl className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {more.map((m) => (
            <div key={m.key} className="border-l-2 border-gray-900 pl-4">
              <dt className="font-semibold">{m.title}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-gray-600">{m.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Money — the deal in plain words, before the price table. */}
      <section className="bg-gray-900 text-white">
        <div className="mx-auto grid max-w-5xl gap-10 px-6 py-20 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{t('money.title')}</h2>
            <p className="mt-4 leading-relaxed text-gray-300">{t('money.body')}</p>
          </div>
          <ul className="space-y-5">
            {(['merchant', 'listed', 'commission', 'cash'] as const).map((k) => (
              <li key={k} className="border-t border-white/15 pt-4">
                <p className="font-semibold">{t(`money.${k}.title`)}</p>
                <p className="mt-1 text-sm leading-relaxed text-gray-400">{t(`money.${k}.body`, commissionRates)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-3xl font-bold tracking-tight">{t('plans.title')}</h2>
        <p className="mt-2 text-gray-600">{t('plans.subtitle')}</p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.tier}
              className={`flex flex-col rounded-xl border bg-white p-6 ${p.featured ? 'border-2 border-gray-900' : 'border-gray-200'}`}
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold">{p.name}</p>
                {p.featured && (
                  <span className="rounded-sm bg-gray-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    {t('plans.mostChosen')}
                  </span>
                )}
              </div>
              {/* Commission is the headline term of the deal, not a footnote —
                  it is what a partner actually pays on every sale. */}
              <p className="mt-5">
                <span className="text-4xl font-bold tracking-tight">{p.commission}</span>
              </p>
              <p className="text-sm text-gray-500">{t('plans.commissionLabel')}</p>
              <p className="mt-4 border-t border-gray-100 pt-4">
                <span className="text-xl font-semibold">{p.price}</span>
                <span className="ml-1 text-sm text-gray-500">{p.note}</span>
              </p>
              <ul className="mt-4 flex-1 space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm text-gray-600">
                    <span className="text-gray-900" aria-hidden>
                      —
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <SignInLink
                cta={`pricing-${p.tier.toLowerCase()}`}
                className={`mt-6 w-full text-center ${
                  p.featured ? 'btn-primary' : 'rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50'
                }`}
              >
                {t('plans.cta')}
              </SignInLink>
            </div>
          ))}
        </div>
      </section>

      {/* Getting started — honest about the Mollie step instead of "in minutes". */}
      <section className="border-t border-gray-200">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-3xl font-bold tracking-tight">{t('start.title')}</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {(['account', 'beach', 'mollie'] as const).map((k, i) => (
              <li key={k}>
                <span className={`${mono} text-sm text-gray-400`}>0{i + 1}</span>
                <h3 className="mt-2 font-semibold">{t(`start.${k}.title`)}</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">{t(`start.${k}.body`)}</p>
              </li>
            ))}
          </ol>
          <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3">
            <SignInLink className="btn-primary px-5 py-2.5" cta="start-sign-up">{t('start.cta')}</SignInLink>
            <span className="text-sm text-gray-500">
              {t('start.questions')}{' '}
              <a href="mailto:partners@sunbnb.app" onClick={() => trackCta('start-email', 'generate_lead')} className="font-medium text-gray-900 underline underline-offset-4">
                partners@sunbnb.app
              </a>
            </span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="flex items-center gap-2">
              <Image alt="Sunbnb" src={sunbnbLogo} className="h-5 w-5 opacity-50" />
              <span className="text-xs text-gray-400">{t('footer.copyright', { year: new Date().getFullYear() })}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-400">
              <a href="/legal/onboarding" className="transition-colors hover:text-gray-600">{t('footer.onboarding')}</a>
              <a href="/legal/merchant-agreement" className="transition-colors hover:text-gray-600">{t('footer.merchantAgreement')}</a>
              <a href="/legal/verifactu" className="transition-colors hover:text-gray-600">{t('footer.verifactu')}</a>
              <a href="/legal/privacy" className="transition-colors hover:text-gray-600">{t('footer.privacy')}</a>
              <a href="mailto:partners@sunbnb.app" onClick={() => trackCta('footer-email', 'generate_lead')} className="transition-colors hover:text-gray-600">{t('footer.contact')}</a>
            </div>
          </div>
          <p className="mt-4 text-[10px] text-gray-400">
            {t('footer.operatedBy', { company: businessEntity.companyName })}
            {businessEntity.businessId ? ` · ${t('footer.businessId', { id: businessEntity.businessId })}` : ''}
            {businessEntity.vatId ? ` · ${t('footer.vatId', { id: businessEntity.vatId })}` : ''}
            {businessEntity.companyAddress ? ` · ${businessEntity.companyAddress}` : ''}
          </p>
        </div>
      </footer>
    </div>
  )
}
