import AccountingView from './view'

export default async function RestaurantAccountingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="container mx-auto max-w-[768px]">
      <AccountingView restaurantId={id} />
    </div>
  )
}
