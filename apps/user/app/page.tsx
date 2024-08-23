import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'

import SitesView from './view'

export default async function Sites() {

  const session = await auth()
  if (!session?.user) return null

  const sites = await prisma.site.findMany({ where: { userId: session.user.id }})
  
  return <SitesView sites={sites} />

}