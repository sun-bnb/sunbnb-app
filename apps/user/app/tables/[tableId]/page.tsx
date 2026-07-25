import { notFound } from 'next/navigation'
import { getDineContext } from './actions'
import DineView from './view'

/**
 * Per-table dine-in QR landing page — the canonical restaurant-anchored
 * route (dine-in v2). A guest scans the table QR → lands here → browses the
 * menu → places tab orders. No auth required; the table CUID in the URL is
 * the sole credential and routing key (no siteId).
 */
export default async function TablePage({
  params,
}: {
  params: { tableId: string }
}) {
  const result = await getDineContext(params.tableId)

  if (result.status === 'error') {
    notFound()
  }

  return <DineView context={result.context} tableId={params.tableId} />
}
