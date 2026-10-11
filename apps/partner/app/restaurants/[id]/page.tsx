import RestaurantView from './view'

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="page-container">
      <RestaurantView restaurantId={id} />
    </div>
  )
}
