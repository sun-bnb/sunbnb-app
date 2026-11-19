import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import ConsentManager from '@/components/ConsentManager'
import WebVitals from '@/components/WebVitals'
import { localeOrDefault } from '@/lib/places.ts'
import { OG_LOCALE, SITE_URL } from '@/lib/seo.ts'
import './globals.css'

const geistSans = localFont({ src: './fonts/GeistVF.woff', variable: '--font-geist-sans' })

/**
 * Site-wide defaults (CR-003). Canonical and og:url are per page (a child's `openGraph` replaces
 * this one wholesale, so pages that set it repeat title/description). og:image: the landing gets
 * app/opengraph-image.tsx from the file convention, other pages list OG_IMAGE (lib/seo.ts);
 * metadataBase makes it absolute on the canonical host.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Meta')
  const locale = localeOrDefault(await getLocale())
  return {
    metadataBase: new URL(SITE_URL),
    title: t('title'),
    description: t('description'),
    icons: { icon: '/logo.ico' },
    openGraph: { title: t('title'), description: t('description'), siteName: 'Sunbnb', locale: OG_LOCALE[locale], type: 'website' },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} font-sans min-h-screen flex flex-col`}>
        <NextIntlClientProvider messages={messages}>
          {children}
          <ConsentManager />
          <WebVitals />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
