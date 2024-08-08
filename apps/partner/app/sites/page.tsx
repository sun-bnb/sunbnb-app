import { PrismaClient } from '@prisma/client'
import { auth } from '@/app/auth'
import Link from 'next/link'

const prisma = new PrismaClient()

export default async function Sites() {

  const session = await auth()
  if (!session?.user) return null

  const sites = await prisma.site.findMany({ where: { userId: session.user.id }})
  
  return (
    <div className="container mx-auto px-4">
      <div>
        {
          sites.map(site => (
            <div key={site.id}>
              <Link href={`/sites/${site.id}`}>{site.name}</Link>
            </div>
          ))
        }
      </div>
      <div>
        <Link href="/sites/create">+ Add site</Link>
      </div>
    </div>
  )

}
