import PosView from './view'
import ErrorCard from '@/components/ErrorCard'
import { getPosContext } from './queries'

export default async function Pos({ params }: { params: { itemId: string }}) {

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  const context = await getPosContext(params.itemId)

  if (!context) return <ErrorCard title="Item not found" message="We couldn't find the sunbed you're looking for." />

  return (
    <PosView
      items={context.items}
      site={context.site}
      availableItemIds={context.availableItemIds}
      apiKey={apiKey}
    />
  )

}
