import RestaurantView from './view'

export default async function RestaurantPage({
  params,
}: {
  params: { id: string }
}) {
  return <RestaurantView restaurantId={params.id} />
}
