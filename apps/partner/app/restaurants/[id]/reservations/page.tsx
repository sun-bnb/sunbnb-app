import ReservationsView from './view'

export default async function ReservationsPage({
  params,
}: {
  params: { id: string }
}) {
  return <ReservationsView restaurantId={params.id} />
}
