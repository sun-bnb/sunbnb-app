import type { Metadata } from 'next'
import localFont from 'next/font/local'
import App from './app'
import NextAuthProvider from './nextauth'
import MuiThemeProvider from './mui-theme'
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <MuiThemeProvider>
          <NextAuthProvider>
            <App>
              {children}
            </App>
          </NextAuthProvider>
        </MuiThemeProvider>
      </body>
    </html>
  )
}
