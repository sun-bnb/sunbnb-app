import RestaurantView from './view'

export default async function RestaurantPage({
  params,
}: {
  params: { id: string }
}) {
  return (
    <div className="container mx-auto max-w-[768px]">
      <RestaurantView restaurantId={params.id} />
    </div>
  )
}
