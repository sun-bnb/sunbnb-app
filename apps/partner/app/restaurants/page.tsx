import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import Link from 'next/link'

interface RestaurantCardProps {
  id: string
  name: string
  siteId: string | null
  siteName: string | null
  tableCount: number
}

function RestaurantCard({ restaurant }: { restaurant: RestaurantCardProps }) {
  return (
    <Link
      href={`/restaurants/${restaurant.id}`}
      prefetch={true}
      className="group block bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-gray-300 hover:shadow-md transition-all duration-200"
    >
      {/* Placeholder banner */}
      <div className="w-full h-[100px] bg-gray-50 flex items-center justify-center border-b border-gray-100">
        <svg
          className="w-8 h-8 text-gray-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"
          />
        </svg>
      </div>

      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-900 truncate mb-1">
          {restaurant.name}
        </h3>

        {restaurant.siteName && (
          <p className="text-xs text-gray-500 mb-2 truncate">
            Linked site: {restaurant.siteName}
          </p>
        )}

        <div className="flex items-center gap-3 text-xs text-gray-400 mt-2">
          <span className="flex items-center gap-1">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
              />
            </svg>
            {restaurant.tableCount} tables
          </span>
        </div>
      </div>
    </Link>
  )
}

function AddRestaurantCard() {
  return (
    <Link
      href="/restaurants/create"
      className="group flex flex-col items-center justify-center bg-white rounded-xl border-2 border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-all duration-200 min-h-[200px]"
    >
      <div className="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-gray-200 flex items-center justify-center mb-3 transition-colors">
        <svg
          className="w-6 h-6 text-gray-400 group-hover:text-gray-600 transition-colors"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </div>
      <span className="text-sm font-medium text-gray-500 group-hover:text-gray-700 transition-colors">
        Create restaurant
      </span>
    </Link>
  )
}

export default async function RestaurantsPage() {
  const session = await auth()
  if (!session?.user) return null

  const rawRestaurants = await prisma.restaurant.findMany({
    where: { partnerAccountId: session.user.id! },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      siteId: true,
      _count: { select: { tables: true } },
    },
  })

  // Fetch linked site names in one query
  const siteIds = rawRestaurants
    .map((r) => r.siteId)
    .filter((id): id is string => id !== null)

  const sites =
    siteIds.length > 0
      ? await prisma.site.findMany({
          where: { id: { in: siteIds } },
          select: { id: true, name: true },
        })
      : []

  const siteNameById = Object.fromEntries(sites.map((s) => [s.id, s.name]))

  const restaurants: RestaurantCardProps[] = rawRestaurants.map((r) => ({
    id: r.id,
    name: r.name,
    siteId: r.siteId,
    siteName: r.siteId ? (siteNameById[r.siteId] ?? null) : null,
    tableCount: r._count.tables,
  }))

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Restaurants</h1>
        {restaurants.length > 0 && (
          <p className="text-sm text-gray-500 mt-0.5">
            {restaurants.length} {restaurants.length === 1 ? 'restaurant' : 'restaurants'}
          </p>
        )}
      </div>

      {restaurants.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"
              />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900 mb-1">No restaurants yet</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-sm">
            Create a restaurant to manage table reservations, menus, and opening hours.
          </p>
          <Link
            href="/restaurants/create"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create restaurant
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AddRestaurantCard />
          {restaurants.map((restaurant) => (
            <RestaurantCard key={restaurant.id} restaurant={restaurant} />
          ))}
        </div>
      )}
    </div>
  )
}
