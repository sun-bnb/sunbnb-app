import AccountingView from './view'

export default async function RestaurantAccountingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="page-container">
      <AccountingView restaurantId={id} />
    </div>
  )
}
