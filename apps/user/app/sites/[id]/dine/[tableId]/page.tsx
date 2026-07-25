import { redirect } from 'next/navigation'

/**
 * Legacy alias for the pre-dine-in-v2 site-anchored QR URL. Old printed QR
 * codes (and mid-flight Mollie returns already carrying `?tabReturn=`) still
 * point here — redirect to the canonical restaurant-anchored
 * `/tables/[tableId]` route, preserving every query param.
 */
export default function LegacyDinePage({
  params,
  searchParams,
}: {
  params: { id: string; tableId: string }
  searchParams: Record<string, string | string[] | undefined>
}) {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v)
    } else {
      qs.append(key, value)
    }
  }
  const query = qs.toString()

  redirect(`/tables/${params.tableId}${query ? `?${query}` : ''}`)
}
