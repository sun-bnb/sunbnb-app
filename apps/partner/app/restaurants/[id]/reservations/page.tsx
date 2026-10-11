import ReservationsView from './view'

export default async function ReservationsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="page-container">
      <ReservationsView restaurantId={id} />
    </div>
  )
}
