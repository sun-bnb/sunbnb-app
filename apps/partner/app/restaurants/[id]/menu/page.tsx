import MenuView from './view'

export default async function MenuPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="container mx-auto max-w-[768px]">
      <MenuView restaurantId={id} />
    </div>
  )
}
