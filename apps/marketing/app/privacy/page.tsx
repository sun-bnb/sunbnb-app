import { getLocale, getTranslations } from 'next-intl/server'
import { getBusinessEntity } from '@repo/data/business-entity'
import { SiteFooter, SiteHeader } from '@/components/SiteChrome'
import { CONSENT_VERSION } from '@/lib/demo-request.ts'
import { localeOrDefault } from '@/lib/places.ts'
import { privacySections } from '@/lib/privacy-content.ts'

export const dynamic = 'force-dynamic'

/** The notice the demo form's consent checkbox links to; its version is stored on each lead. */
export default async function PrivacyPage() {
  const t = await getTranslations('Privacy')
  const entity = await getBusinessEntity()
  const sections = privacySections(localeOrDefault(await getLocale()), entity)
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-xs text-gray-400">{t('updated', { version: CONSENT_VERSION })}</p>
        {sections.map((s) => (
          <section key={s.heading} className="mt-8">
            <h2 className="text-sm font-semibold text-gray-900">{s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="mt-2 text-sm leading-relaxed text-gray-600">
                {p}
              </p>
            ))}
          </section>
        ))}
      </main>
      <SiteFooter />
    </>
  )
}
