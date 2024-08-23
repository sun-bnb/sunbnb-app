
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
    <div className="container mx-auto pt-4">
      <div>
        {
          sites.map(site => (
            <div className="mb-6" key={site.id}>
              <div className="w-full h-[160px] mr-2 mt-1 overflow-hidden bg-gray-100 flex items-center relative">
                { 
                  site.image && 
                  <Link href={`/sites/${site.id}`}>
                    <img width="100%" src={site.image} />
                  </Link>
                }
                <div className="font-bold text-white px-2 py-1 absolute top-[6px] left-[6px] bg-black bg-opacity-30 rounded-xl">
                  <Link href={`/sites/${site.id}`}>{site.name}</Link>
                </div>
              </div>
              <div className="py-3">
                <div className="px-1 flex">
                  <div className="mr-3">
                    <span className="mr-1">&#x26F1;</span>
                    <span className="text-green-600">6</span>
                    <span className="text-gray-400 mx-[1px]">/</span>
                    <span className="text-gray-400">14</span>
                  </div>
                  <div className="mr-3">
                    <span className="mr-[2px]">1.8</span>
                    <span className="text-xs">KM</span>
                  </div>
                  <div className="mr-3">
                    <span>&#8364;</span>
                    <span>8</span>
                  </div>
                </div>
                <div className="px-1 py-2">
                  { site.description }
                </div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )

}