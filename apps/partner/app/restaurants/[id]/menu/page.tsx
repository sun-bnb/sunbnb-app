import MenuView from './view'

export default async function MenuPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="page-container">
      <MenuView restaurantId={id} />
    </div>
  )
}
