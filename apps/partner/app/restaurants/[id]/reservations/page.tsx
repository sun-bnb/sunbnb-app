import ReservationsView from './view'

export default async function ReservationsPage({
  params,
}: {
  params: { id: string }
}) {
  return (
    <div className="container mx-auto max-w-[768px]">
      <ReservationsView restaurantId={params.id} />
    </div>
  )
}
