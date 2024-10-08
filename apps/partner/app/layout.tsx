import type { Metadata } from "next"
import localFont from "next/font/local"
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
  title: "Create Next App",
  description: "Generated by create next app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <StoreProvider>
        <body className={`${geistSans.variable} ${geistMono.variable}`}>
          <NextAuthProvider>
            <App>
              {children}
            </App>
          </NextAuthProvider>
        </body>
      </StoreProvider>
    </html>
  )
}
