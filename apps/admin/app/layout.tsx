import type { Metadata } from 'next'
import localFont from 'next/font/local'
import App from './app'
import NextAuthProvider from './nextauth'
import MuiThemeProvider from './mui-theme'
import { CookieConsent } from '@repo/ui/cookie-consent'
import { FlagsProvider } from '@repo/ui/flags'
import { getClientFlags } from './flags'
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
  title: 'Sunbnb - Admin',
  description: 'Platform administration',
  icons: {
    icon: '/logo.ico',
    apple: '/logo-lila.png'
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const flags = await getClientFlags()
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <FlagsProvider value={flags}>
          <MuiThemeProvider>
            <NextAuthProvider>
              <App>
                {children}
              </App>
              <CookieConsent privacyHref="#" />
            </NextAuthProvider>
          </MuiThemeProvider>
        </FlagsProvider>
      </body>
    </html>
  )
}
