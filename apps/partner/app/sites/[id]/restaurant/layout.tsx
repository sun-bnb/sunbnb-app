import { notFound } from 'next/navigation'
import { isFlagEnabled } from '@/app/flags'

export default async function RestaurantLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!(await isFlagEnabled('restaurants'))) notFound()
  return <>{children}</>
}
