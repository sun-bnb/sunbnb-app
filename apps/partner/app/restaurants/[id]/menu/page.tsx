import MenuView from './view'

export default async function MenuPage({
  params,
}: {
  params: { id: string }
}) {
  return <MenuView restaurantId={params.id} />
}
