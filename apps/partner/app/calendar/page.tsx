import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import CalendarView from './view'


export default async function CalendarPage() {

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
      <CalendarView sites={sites} />
    </div>
  )

}
