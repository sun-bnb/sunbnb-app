import TablesView from './view'

export default async function TablesPage({
  params,
}: {
  params: { id: string }
}) {
  return <TablesView restaurantId={params.id} />
}
