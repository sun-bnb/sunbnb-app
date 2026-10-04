import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import './globals.css'

const geistSans = localFont({ src: './fonts/GeistVF.woff', variable: '--font-geist-sans' })

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Meta')
  return {
    title: t('title'),
    description: t('description'),
    icons: { icon: '/logo.ico' },
    openGraph: { title: t('title'), description: t('description'), url: 'https://try.sunbnb.app', siteName: 'Sunbnb' },
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} font-sans min-h-screen flex flex-col`}>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
