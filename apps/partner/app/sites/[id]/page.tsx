import { PrismaClient } from '@prisma/client'
import { auth } from '@/app/auth'
import { SiteProps } from '@/app/sites/types'
import Link from 'next/link'
import SiteView from './view'
import SiteEdit from './edit'

const prisma = new PrismaClient()

export default async function Site({ params, searchParams }: { params: { id: string }, searchParams: URLSearchParams }) {

  console.log('params', params)
  const session = await auth()
  if (!session?.user) return null

  let mode = 'edit'

  let site: SiteProps | null = {
    name: ''
  }

  if (params.id !== 'create') {
    mode = 'view'
    site = await prisma.site.findFirst({ where: { userId: session.user.id }})
  }
  
  let content = null
  if (mode === 'view') {
    content = <SiteView {...site} />
  } else {
    content = <SiteEdit {...site} />
  }

  return (
    <div className="container mx-auto px-4">
      { content }
    </div>
  )

}