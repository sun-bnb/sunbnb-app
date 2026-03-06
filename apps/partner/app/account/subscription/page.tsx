import { auth } from '@/app/auth'
import { getSubscriptionData } from './actions'
import SubscriptionView from './view'

export default async function SubscriptionPage() {
  const session = await auth()
  if (!session?.user) return null

  const data = await getSubscriptionData()
  if (!data) return null

  return <SubscriptionView data={data} />
}
