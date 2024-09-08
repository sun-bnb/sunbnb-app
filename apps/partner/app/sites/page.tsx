import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import Link from 'next/link'
import Image from 'next/image'
import Button from '@mui/material/Button'
import { SiteProps } from '../../types/shared'

function Site({ site }: { site: SiteProps }) {
  return (
    <div className="mb-6 min-w-[320px] w-full md:w-[360px]" key={site.id}>
      <div className="w-full h-[160px] mr-2 mt-1 overflow-hidden bg-gray-100 flex items-center relative">
        { 
          site.image && 
          <Link className="w-full" href={`/sites/${site.id}`} prefetch={true}>
            {
              (site.imageWidth && site.imageHeight) &&
                <Image width={site.imageWidth} height={site.imageHeight} alt={site.description || ''} src={site.image} />
    }
          </Link>
        }
        <div className="font-bold text-white px-2 py-1 absolute top-[6px] left-[6px] bg-black bg-opacity-30 rounded-xl">
          <Link href={`/sites/${site.id}`} prefetch={true}>{site.name}</Link>
        </div>
        <div className="flex absolute bottom-[6px] right-[6px] font-bold text-white px-2 py-1 bg-black bg-opacity-30 rounded-xl">
          <div className="">
            <span className="mr-1">&#x26F1;</span>
            <span>{site.inventoryItems?.length || 0}</span>
          </div>    
        </div>
      </div>
    </div>
  )
}

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
    <div className="container mx-auto">
      <div className="flex w-full flex-wrap md:gap-x-4">
        {
          sites.map(site => (
            <div key={site.id} className="flex justify-between">
              <Site site={site} />
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
