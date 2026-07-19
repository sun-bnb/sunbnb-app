import { notFound } from 'next/navigation'
import { getDineContext } from './actions'
import DineView from './view'

/**
 * Per-table dine-in QR landing page.
 * A guest scans the table QR → lands here → browses the menu → places tab orders.
 * No auth required; the table CUID in the URL is the credential.
 */
export default async function DinePage({
  params,
}: {
  params: { id: string; tableId: string }
}) {
  const result = await getDineContext(params.id, params.tableId)

  if (result.status === 'error') {
    notFound()
  }

  return <DineView context={result.context} />
}
