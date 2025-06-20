import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import localFont from 'next/font/local'
import App from './app'
import NextAuthProvider from './nextauth'
import StoreProvider from './StoreProvider'
import './globals.css'


const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
})
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
})

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

  return (
    <html lang={locale}>
      <StoreProvider>
        <body className={`${geistSans.variable} ${geistMono.variable}`}>
          <NextAuthProvider>
            <NextIntlClientProvider messages={messages}>
              <App>
                {children}
              </App>
            </NextIntlClientProvider>
          </NextAuthProvider>
        </body>
      </StoreProvider>
    </html>
  )
}
