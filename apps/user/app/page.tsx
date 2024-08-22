
import Button from '@mui/material/Button'
import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import Link from 'next/link'
import styles from './page.module.css'
import Glow from './Glow'

export default async function Sites() {

  const session = await auth()
  if (!session?.user) return null

  const sites = await prisma.site.findMany({ where: { userId: session.user.id }})
  
  return (
    <div className="container mx-auto p-4">
      <div>
        {
          sites.map(site => (
            <div className="flex mb-2" key={site.id}>
              <div className="w-[80px] h-[60px] mr-2 mt-1 overflow-hidden">
                { 
                  site.image && 
                  <Link href={`/sites/${site.id}`}>
                    <img width="100%" src={site.image} />
                  </Link>
                }
              </div>
              <div>
                <div className="font-bold">
                  <Link href={`/sites/${site.id}`}>{site.name}</Link>
                </div>
                <div>
                  <span className="mr-1">&#x26F1;</span>
                  <span className="text-green-600">6</span>
                  <span className="text-gray-400 mx-[1px]">/</span>
                  <span className="text-gray-400">14</span>
                </div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )

}