import RestaurantView from './view'

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="container mx-auto max-w-[768px]">
      <RestaurantView restaurantId={id} />
    </div>
  )
}
