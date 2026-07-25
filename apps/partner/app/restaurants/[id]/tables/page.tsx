import { getTablesList } from '../queries'
import TablesView from './view'

export default async function TablesPage({
  params,
}: {
  params: { id: string }
}) {
  // Dine-in v2: /tables/<tableId> is table-id-keyed only (no siteId needed),
  // so active tables are fetched unconditionally — standalone restaurants can
  // print QR codes the same as site-linked ones. getTablesList is
  // ownership-checked (returns [] on auth failure).
  const activeTables = await getTablesList(params.id)

  // CONSUMER_APP_URL is server-side only (no NEXT_PUBLIC_ prefix). We resolve it
  // here on the server and pass it down as a plain string prop so the client QR
  // button never needs to read env vars directly.
  const consumerAppUrl =
    process.env.CONSUMER_APP_URL ?? 'https://sunbnb.app'

  return (
    <div className="container mx-auto max-w-[768px]">
      <TablesView
        restaurantId={params.id}
        consumerAppUrl={consumerAppUrl}
        activeTables={activeTables}
      />
    </div>
  )
}
