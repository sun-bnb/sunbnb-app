import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { canCreateSite } from '@repo/data/subscription'
import Link from 'next/link'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'

interface SiteCardProps {
  id: string
  name: string
  description?: string | null
  image?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  status?: string | null
  type?: string | null
  price?: number | null
  vat?: number | null
  orderPaymentType?: string | null
  rentalPaymentType?: string | null
  workingHoursCount: number
  activeInventoryCount: number
  mollieReady: boolean
  _count: { inventoryItems: number; products: number; reservations: number }
}

type T = (key: string, values?: Record<string, string | number>) => string

function StatusBadge({ status, t }: { status: string | null | undefined; t: T }) {
  const isActive = status === 'active'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
      isActive
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-gray-100 text-gray-500'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
      {isActive ? t('active') : (status || t('draft'))}
    </span>
  )
}

function countMissing(site: SiteCardProps): number {
  let missing = 0
  if (!site.name || !site.name.trim()) missing++
  if (site.type === 'paid' && (!site.price || site.price <= 0)) missing++
  if (site.type === 'paid' && site.vat == null) missing++
  const hasIntegratedPayments = site.type === 'paid'
    || site.orderPaymentType === 'paid'
    || site.rentalPaymentType === 'paid'
  if (hasIntegratedPayments && !site.mollieReady) missing++
  if (site.activeInventoryCount === 0) missing++
  if (site.workingHoursCount === 0) missing++
  if (!site.image) missing++
  return missing
}

function SetupBadge({ site, t }: { site: SiteCardProps; t: T }) {
  const missing = countMissing(site)
  if (missing === 0) return null
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
      </svg>
      {missing} {t('toDo')}
    </span>
  )
}

function AddSiteCard({ allowed, tier, currentCount, maxSites, t }: {
  allowed: boolean
  tier: string
  currentCount: number
  maxSites: number
  t: T
}) {
  if (allowed) {
    return (
      <Link
        href="/sites/create"
        className="group flex flex-col items-center justify-center bg-white rounded-xl border-2 border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-all duration-200 min-h-[260px]"
      >
        <div className="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-gray-200 flex items-center justify-center mb-3 transition-colors">
          <svg className="w-6 h-6 text-gray-400 group-hover:text-gray-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </div>
        <span className="text-sm font-medium text-gray-500 group-hover:text-gray-700 transition-colors">
          {t('addSite')}
        </span>
      </Link>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 min-h-[260px] opacity-60">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      </div>
      <span className="text-sm font-medium text-gray-400 mb-1">{t('siteLimitReached')}</span>
      <span className="text-xs text-gray-400 mb-3">
        {tier} — {currentCount}/{maxSites} {t('siteCount', { count: maxSites })}
      </span>
      <Link
        href="/account/subscription"
        className="text-xs font-medium text-indigo-500 hover:text-indigo-600 transition-colors"
      >
        {t('upgradePlan')}
      </Link>
    </div>
  )
}

function SiteCard({ site, t }: { site: SiteCardProps; t: T }) {
  return (
    <Link
      href={`/sites/${site.id}/general`}
      prefetch={true}
      className="group block bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-gray-300 hover:shadow-md transition-all duration-200"
    >
      {/* Image */}
      <div className="relative w-full h-[160px] bg-gray-100 overflow-hidden">
        {site.image && site.imageWidth && site.imageHeight ? (
          <Image
            src={site.image}
            alt={site.description || site.name}
            width={site.imageWidth}
            height={site.imageHeight}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
            </svg>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{site.name}</h3>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <SetupBadge site={site} t={t} />
            <StatusBadge status={site.status} t={t} />
          </div>
        </div>

        {site.description && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-3">{site.description}</p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1" title="Inventory items">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5M10.5 21V8.94a.75.75 0 0 0-.82-.747l-7.5.856A.75.75 0 0 0 1.5 9.848V21" />
            </svg>
            {site._count.inventoryItems}
          </span>
          <span className="flex items-center gap-1" title="Products">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25" />
            </svg>
            {site._count.products}
          </span>
          <span className="flex items-center gap-1" title="Reservations">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
            {site._count.reservations}
          </span>
          {site.type === 'paid' && site.price && (
            <span className="ml-auto font-medium text-gray-600">
              €{site.price}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export default async function Sites() {

  const session = await auth()
  if (!session?.user) return null

  const [sites, siteLimit, partnerAccount, t] = await Promise.all([
    prisma.site.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        image: true,
        imageWidth: true,
        imageHeight: true,
        status: true,
        type: true,
        price: true,
        vat: true,
        orderPaymentType: true,
        rentalPaymentType: true,
        inventoryItems: { where: { status: 'active' }, select: { id: true } },
        _count: {
          select: {
            inventoryItems: true,
            products: true,
            reservations: true,
            workingHours: true,
          }
        }
      }
    }).then(sites => sites.map(({ inventoryItems: activeItems, ...s }) => ({
      ...s,
      workingHoursCount: s._count.workingHours,
      activeInventoryCount: activeItems.length,
    }))),
    canCreateSite(session.user.id!),
    prisma.partnerAccount.findUnique({
      where: { userId: session.user.id! },
      select: { mollieAccessToken: true, mollieOnboardingStatus: true },
    }),
    getTranslations('Sites'),
  ])

  const mollieReady = !!partnerAccount?.mollieAccessToken && partnerAccount?.mollieOnboardingStatus === 'completed'

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {t('siteCount', { count: sites.length })}
        </p>
      </div>

      {/* Grid — Add-site card is always the first element */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <AddSiteCard
          allowed={siteLimit.allowed}
          tier={siteLimit.tier}
          currentCount={siteLimit.currentCount}
          maxSites={siteLimit.maxSites}
          t={t as unknown as T}
        />
        {sites.map(site => (
          <SiteCard key={site.id} site={{ ...site, mollieReady }} t={t as unknown as T} />
        ))}
      </div>
    </div>
  )
}
