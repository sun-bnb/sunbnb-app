import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import localFont from 'next/font/local'
import { getBusinessEntity } from '@repo/data/business-entity'
import App from './app'
import NextAuthProvider from './nextauth'
import StoreProvider from './StoreProvider'
import { CookieConsent } from '@repo/ui/cookie-consent'
import { FlagsProvider } from '@repo/ui/flags'
import { getClientFlags } from './flags'
import { auth } from './auth'
import ImpersonationBanner from '@/components/ImpersonationBanner'
import './globals.css'


const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
})
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Sunbnb - Partner portal',
  description: 'Your partner in sunbed management',
  icons: {
    icon: '/logo.ico',
    apple: '/logo-lila.png'
  },
  openGraph: {
    title: 'Sunbnb - Partner portal',
    description: 'Your partner in sunbed management',
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
    title: 'Sunbnb - Partner portal',
    description: 'Your partner in sunbed management',
    images: ['https://sunbnb.app/sunbnb-thumbnail.png'],
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  const locale = await getLocale()
  const messages = await getMessages()
  const businessEntity = await getBusinessEntity()
  const flags = await getClientFlags()
  const session = await auth()
  const impersonatingUser = (session?.user as { impersonating?: boolean; email?: string | null } | undefined)
  const isImpersonating = !!impersonatingUser?.impersonating

  return (
    <html lang={locale}>
      <StoreProvider>
        <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased ${isImpersonating ? 'pt-10' : ''}`}>
          {isImpersonating && <ImpersonationBanner email={impersonatingUser?.email} />}
          <FlagsProvider value={flags}>
            <NextAuthProvider>
              <NextIntlClientProvider messages={messages}>
                <App businessEntity={businessEntity}>
                  {children}
                </App>
                <CookieConsent />
              </NextIntlClientProvider>
            </NextAuthProvider>
          </FlagsProvider>
        </body>
      </StoreProvider>
    </html>
  )
}
