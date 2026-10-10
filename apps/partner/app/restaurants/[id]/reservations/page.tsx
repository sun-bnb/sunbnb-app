import ReservationsView from './view'

export default async function ReservationsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="container mx-auto max-w-[768px]">
      <ReservationsView restaurantId={id} />
    </div>
  )
}
