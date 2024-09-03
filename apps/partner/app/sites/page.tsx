import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import Link from 'next/link'
import Button from '@mui/material/Button'

export default async function Sites() {

  const session = await auth()
  if (!session?.user) return null

  const sites = await prisma.site.findMany({ 
    where: { userId: session.user.id },
    include: {
      inventoryItems: true
    }
  })
  
  return (
    <div className="container mx-auto p-4">
      <div>
        {
          sites.map(site => (
            <div key={site.id} className="flex justify-between">
              <div>
                <Link href={`/sites/${site.id}`} className="underline">{site.name}</Link>
              </div>
              <div>
                { site.inventoryItems.length } items
              </div>
            </div>
          ))
        }
      </div>
      <div className="mt-4 mb-2 w-full flex justify-end">
        <Link href="/sites/create" className="w-full">
          <Button fullWidth={true} variant="outlined">+ Add site</Button>
        </Link>
      </div>
    </div>
  )

}
