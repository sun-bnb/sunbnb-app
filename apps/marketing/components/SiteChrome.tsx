import Image from 'next/image'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export const PARTNER_PORTAL_URL = process.env.NEXT_PUBLIC_PARTNER_URL ?? 'https://partner.sunbnb.app'

export async function SiteHeader() {
  const t = await getTranslations('Header')
  return (
    <header className="border-b border-gray-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/sunbnb-logo.svg" alt="" width={28} height={26} />
          <span className="text-lg font-semibold tracking-tight">Sunbnb</span>
        </Link>
        <a href={PARTNER_PORTAL_URL} className="btn-ghost">
          {t('signIn')}
        </a>
      </div>
    </header>
  )
}

export async function SiteFooter() {
  const t = await getTranslations()
  return (
    <footer className="mt-auto border-t border-gray-100">
      <div className="mx-auto flex max-w-6xl justify-between px-4 py-6 text-xs text-gray-400">
        <span>{t('Footer.copyright', { year: new Date().getFullYear() })}</span>
        <Link href="/privacy" className="hover:text-gray-600">
          {t('Privacy.link')}
        </Link>
      </div>
    </footer>
  )
}
