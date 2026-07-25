import AccountingView from './view'

export default async function RestaurantAccountingPage({
  params,
}: {
  params: { id: string }
}) {
  return (
    <div className="container mx-auto max-w-[768px]">
      <AccountingView restaurantId={params.id} />
    </div>
  )
}
