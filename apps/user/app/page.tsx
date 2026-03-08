import { getBusinessEntity } from '@repo/data/business-entity'
import HomeView from './view'

export default async function HomePage() {
  const entity = await getBusinessEntity()
  return <HomeView businessEntity={entity} />
}
