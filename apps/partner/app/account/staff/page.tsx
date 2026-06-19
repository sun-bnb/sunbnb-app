import { auth } from '@/app/auth'
import StaffView from './view'

export default async function StaffPage() {
  const session = await auth()
  if (!session) return null

  return <StaffView />
}
