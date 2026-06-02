'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import sunbnbLogo from '@/app/sunbnb-logo.svg'

interface BusinessEntity {
  companyName: string
  companyAddress: string | null
  businessId: string | null
  vatId: string | null
  contactEmail: string | null
  contactPhone: string | null
}

export default function LandingPage({ businessEntity }: { businessEntity: BusinessEntity }) {
  const router = useRouter()
  const t = useTranslations('Landing')

  const features = [
    {
      title: t('feature1Title'),
      desc: t('feature1Desc'),
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
        </svg>
      ),
    },
    {
      title: t('feature2Title'),
      desc: t('feature2Desc'),
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>
      ),
    },
    {
      title: t('feature3Title'),
      desc: t('feature3Desc'),
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
        </svg>
      ),
    },
    {
      title: t('feature4Title'),
      desc: t('feature4Desc'),
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
        </svg>
      ),
    },
    {
      title: t('feature5Title'),
      desc: t('feature5Desc'),
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
        </svg>
      ),
    },
    {
      title: t('feature6Title'),
      desc: t('feature6Desc'),
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
        </svg>
      ),
    },
  ]

  const plans = [
    {
      name: t('planStarter'),
      price: t('planStarterPrice'),
      note: t('planStarterNote'),
      highlight: false,
      features: [
        t('feat1Site'),
        t('featIntegratedPayments'),
        t('feat5Fee'),
        t('featCommunitySupport'),
      ],
      footnote: t('starterFeeNote'),
    },
    {
      name: t('planPro'),
      price: '€29',
      note: t('planProNote'),
      highlight: true,
      features: [
        t('feat1Site'),
        t('featIntegratedPayments'),
        t('featOffPlatformBilling'),
        t('feat2Fee'),
        t('featPrioritySupport'),
      ],
    },
    {
      name: t('planBusiness'),
      price: '€79',
      note: t('planBusinessNote'),
      highlight: false,
      features: [
        t('featUnlimitedSites'),
        t('featIntegratedPayments'),
        t('featOffPlatformBilling'),
        t('featNoFee'),
        t('featBranded'),
        t('featDedicatedSupport'),
      ],
    },
  ]

  return (
    <div className="min-h-screen bg-white">

      {/* Nav */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image alt="Sunbnb" src={sunbnbLogo} className="w-8 h-8" />
            <span className="text-sm font-bold text-gray-900">sunbnb</span>
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider ml-1">{t('partnerBadge')}</span>
          </div>
          <button
            onClick={() => router.push('/sign-in')}
            className="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
          >
            {t('signIn')}
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 rounded-full mb-6">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
          <span className="text-xs font-medium text-emerald-700">{t('acceptingPartners')}</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 tracking-tight leading-tight max-w-3xl mx-auto">
          {t('heroLine1')}{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-emerald-500">
            {t('heroEmphasis')}
          </span>
        </h1>
        <p className="mt-5 text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
          {t('heroDescription')}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={() => router.push('/sign-in')}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors shadow-sm"
          >
            {t('getStartedNow')}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold text-gray-900">{t('featuresTitle')}</h2>
          <p className="mt-2 text-sm text-gray-500">{t('featuresSubtitle')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="bg-gray-50 rounded-xl p-5 border border-gray-100">
              <div className="w-10 h-10 bg-white rounded-lg border border-gray-200 flex items-center justify-center text-gray-700 mb-3">
                {f.icon}
              </div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold text-gray-900">{t('pricingTitle')}</h2>
          <p className="mt-2 text-sm text-gray-500">{t('pricingSubtitle')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`rounded-xl p-5 border flex flex-col ${
                p.highlight
                  ? 'border-blue-500 ring-2 ring-blue-500 bg-white'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <p className="text-sm font-semibold text-gray-900">{p.name}</p>
              <div className="mt-2 mb-4">
                <span className="text-2xl font-bold text-gray-900">{p.price}</span>
                <span className="text-sm text-gray-400 ml-1">{p.note}</span>
                {p.footnote && (
                  <p className="text-xs text-gray-400 mt-1">{p.footnote}</p>
                )}
              </div>
              <ul className="space-y-2 mb-5 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-500">
                    <svg className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => router.push('/sign-in')}
                className={`w-full py-2 text-sm font-medium rounded-lg transition-colors ${
                  p.highlight
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {t('getStarted')}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 py-16 text-center">
        <div className="bg-gray-900 rounded-2xl p-10 md:p-14">
          <h2 className="text-2xl md:text-3xl font-bold text-white">
            {t('ctaTitle')}
          </h2>
          <p className="mt-3 text-gray-400 max-w-xl mx-auto">
            {t('ctaBody')}
          </p>
          <button
            onClick={() => router.push('/sign-in')}
            className="mt-6 inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-gray-900 bg-white rounded-lg hover:bg-gray-100 transition-colors"
          >
            {t('signUpGoogle')}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 mt-8">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="flex items-center gap-2">
              <Image alt="Sunbnb" src={sunbnbLogo} className="w-5 h-5 opacity-50" />
              <span className="text-xs text-gray-400">{t('footerCopyright', { year: new Date().getFullYear() })}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-400">
              <a href="/legal/onboarding" className="hover:text-gray-600 transition-colors">{t('footerOnboarding')}</a>
              <a href="/legal/merchant-agreement" className="hover:text-gray-600 transition-colors">{t('footerMerchantAgreement')}</a>
              <a href="/legal/verifactu" className="hover:text-gray-600 transition-colors">{t('footerVerifactu')}</a>
              <a href="mailto:partners@sunbnb.app" className="hover:text-gray-600 transition-colors">{t('footerContact')}</a>
            </div>
          </div>
          <p className="mt-4 text-[10px] text-gray-300">
            {t('footerOperatedBy', { company: businessEntity.companyName })}
            {businessEntity.businessId ? ` · ${t('footerBusinessId', { id: businessEntity.businessId })}` : ''}
            {businessEntity.vatId ? ` · ${t('footerVatId', { id: businessEntity.vatId })}` : ''}
            {businessEntity.companyAddress ? ` · ${businessEntity.companyAddress}` : ''}
          </p>
        </div>
      </footer>
    </div>
  )
}
