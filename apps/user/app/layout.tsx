import logger from '@/utils/logger'

import type { Metadata } from 'next'
import { ConsentAwareAnalytics } from '@/components/consent-analytics'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import localFont from 'next/font/local'
import App from './app'
import NextAuthProvider from './nextauth'
import { CookieConsent } from '@repo/ui/cookie-consent'
import { FlagsProvider } from '@repo/ui/flags'
import { getClientFlags } from './flags'
import { auth } from './auth'
import ImpersonationBanner from '@/components/ImpersonationBanner'
import './globals.css'
import StoreProvider from "./StoreProvider"

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
})
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
})

export const metadata: Metadata = {
  title: 'Sunbnb - Your place under the sun',
  description: 'Sunbed reservation made easy',
  icons: {
    icon: '/logo.ico',
    apple: '/logo-lila.png'
  },
  openGraph: {
    title: 'Sunbnb - Your place under the sun',
    description: 'Sunbed reservation made easy',
    url: 'https://sunbnb.app',
    siteName: 'Sunbnb',
    images: [
      {
        url: 'https://sunbnb.app/sunbnb-thumbnail.png',
        width: 561,
        height: 348,
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sunbnb - Your place under the sun',
    description: 'Sunbed reservation made easy',
    images: ['https://sunbnb.app/sunbnb-thumbnail.png'],
  }
}


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  const locale = await getLocale()
  const messages = await getMessages()
  const flags = await getClientFlags()
  const session = await auth()
  const impersonatingUser = (session?.user as { impersonating?: boolean; email?: string | null } | undefined)
  const isImpersonating = !!impersonatingUser?.impersonating

  return (
    <html lang={locale}>
      <StoreProvider>
        <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-cream min-h-screen ${isImpersonating ? 'pt-10' : ''}`}>
          {isImpersonating && <ImpersonationBanner email={impersonatingUser?.email} />}
          <FlagsProvider value={flags}>
            <NextAuthProvider>
              <NextIntlClientProvider messages={messages}>
                <App>
                  {children}
                </App>
                <CookieConsent hasAnalytics />
                <ConsentAwareAnalytics />
              </NextIntlClientProvider>
            </NextAuthProvider>
          </FlagsProvider>
        </body>
      </StoreProvider>
    </html>
  )
}
