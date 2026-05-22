import TablesView from './view'

export default async function TablesPage({
  params,
}: {
  params: { id: string }
}) {
  return (
    <div className="container mx-auto max-w-[768px]">
      <TablesView restaurantId={params.id} />
    </div>
  )
}
