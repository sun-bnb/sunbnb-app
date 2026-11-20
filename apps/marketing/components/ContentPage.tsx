import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { SiteFooter, SiteHeader } from '@/components/SiteChrome'
import { CONTENT_LOCALE, contentPath, contentSlugs, findContentPage, type ContentSection } from '@/lib/content-pages.ts'
import { OG_IMAGE, OG_LOCALE, SITE_URL } from '@/lib/seo.ts'

/**
 * Shared body of the /guias/<slug> and /es/<slug> routes (CR-003). Light on purpose: site header
 * and footer, no map `Experience`. The language is the route's (proxy.ts), never the visitor's.
 */
export function contentStaticParams(section: ContentSection) {
  return contentSlugs(section)
}

export function contentMetadata(section: ContentSection, slug: string): Metadata {
  const page = findContentPage(section, slug)
  if (!page) return {}
  const url = `${SITE_URL}${contentPath(page)}`
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      title: page.title,
      description: page.description,
      url,
      siteName: 'Sunbnb',
      locale: OG_LOCALE[CONTENT_LOCALE],
      type: 'article',
      images: [OG_IMAGE],
    },
    ...(page.published ? {} : { robots: { index: false, follow: false } }),
  }
}

export async function ContentPageView({ section, slug }: { section: ContentSection; slug: string }) {
  const page = findContentPage(section, slug)
  if (!page) notFound()
  const t = await getTranslations('Content')
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <article>
          <h1 className="text-3xl font-semibold tracking-tight text-[#0e3a4a]">{page.heading}</h1>
          <p className="mt-4 text-[17px] leading-relaxed text-[#0e3a4a]/80">{page.intro}</p>
          {page.sections.map((s) => (
            <section key={s.heading} className="mt-10">
              <h2 className="text-xl font-semibold text-[#0e3a4a]">{s.heading}</h2>
              {s.paragraphs.map((p) => (
                <p key={p} className="mt-3 text-[15px] leading-relaxed text-[#0e3a4a]/75">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </article>
        <aside className="mt-12 rounded-3xl border-2 border-[#0e3a4a] bg-white p-6">
          <h2 className="text-xl font-semibold text-[#0e3a4a]">{t('ctaTitle')}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-[#0e3a4a]/75">{t('ctaBody')}</p>
          {/* Relative: on try.sunbnb.app this is https://try.sunbnb.app/, and previews stay on their own host. */}
          <Link href="/" className="btn-primary-lg mt-5 inline-block">
            {t('ctaButton')}
          </Link>
        </aside>
      </main>
      <SiteFooter />
    </>
  )
}
