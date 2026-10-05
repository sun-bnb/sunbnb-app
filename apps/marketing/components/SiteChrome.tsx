import Image from 'next/image'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import CookieSettingsLink from './CookieSettingsLink'

export const PARTNER_PORTAL_URL = process.env.NEXT_PUBLIC_PARTNER_URL ?? 'https://partner.sunbnb.app'

/** `overlay`: floats transparently over the immersive scene instead of sitting above it. */
export async function SiteHeader({ overlay = false }: { overlay?: boolean } = {}) {
  const t = await getTranslations('Header')
  return (
    <header className={overlay ? 'absolute inset-x-0 top-0 z-20' : 'border-b border-gray-100 bg-white/80 backdrop-blur'}>
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
        <span className="flex gap-4">
          <CookieSettingsLink label={t('Consent.settings')} />
          <Link href="/privacy" className="hover:text-gray-600">
            {t('Privacy.link')}
          </Link>
        </span>
      </div>
    </footer>
  )
}
