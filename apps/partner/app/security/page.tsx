import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import SecurityView from './view'
  
export default async function Account() {

  const session = await auth()

  if (!session) return null
  const { user } = session

  return <SecurityView />

}