import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import Link from 'next/link'
import Image from 'next/image'

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
  _count: { inventoryItems: number; products: number; reservations: number }
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const isActive = status === 'active'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
      isActive
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-gray-100 text-gray-500'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
      {isActive ? 'Active' : status || 'Draft'}
    </span>
  )
}

function SiteCard({ site }: { site: SiteCardProps }) {
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
          <StatusBadge status={site.status} />
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

  const sites = await prisma.site.findMany({
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
      _count: {
        select: {
          inventoryItems: true,
          products: true,
          reservations: true,
        }
      }
    }
  })

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Sites</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {sites.length} {sites.length === 1 ? 'site' : 'sites'}
          </p>
        </div>
        <Link
          href="/sites/create"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add site
        </Link>
      </div>

      {/* Grid */}
      {sites.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sites.map(site => (
            <SiteCard key={site.id} site={site} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border border-dashed border-gray-300 rounded-xl">
          <svg className="mx-auto w-10 h-10 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21" />
          </svg>
          <p className="text-sm text-gray-500 mb-4">No sites yet</p>
          <Link
            href="/sites/create"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
          >
            Create your first site
          </Link>
        </div>
      )}
    </div>
  )
}
