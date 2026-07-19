import { getRestaurant, getTablesList } from '../queries'
import TablesView from './view'

export default async function TablesPage({
  params,
}: {
  params: { id: string }
}) {
  // Load restaurant to get siteId (needed for dine-in QR URLs).
  // getRestaurant is ownership-checked; returns null if unauth or wrong owner.
  const restaurant = await getRestaurant(params.id)
  const siteId = restaurant?.siteId ?? null

  // Only fetch tables for QR if this restaurant has a linked site (dine-in tabs
  // require the Site/Product rails; standalone restaurants can't use them).
  const activeTables = siteId ? await getTablesList(params.id) : []

  // CONSUMER_APP_URL is server-side only (no NEXT_PUBLIC_ prefix). We resolve it
  // here on the server and pass it down as a plain string prop so the client QR
  // button never needs to read env vars directly.
  const consumerAppUrl =
    process.env.CONSUMER_APP_URL ?? 'https://sunbnb.app'

  return (
    <div className="container mx-auto max-w-[768px]">
      <TablesView
        restaurantId={params.id}
        siteId={siteId}
        consumerAppUrl={consumerAppUrl}
        activeTables={activeTables}
      />
    </div>
  )
}
