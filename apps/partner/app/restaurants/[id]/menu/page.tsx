import MenuView from './view'

export default async function MenuPage({
  params,
}: {
  params: { id: string }
}) {
  return (
    <div className="container mx-auto max-w-[768px]">
      <MenuView restaurantId={params.id} />
    </div>
  )
}
