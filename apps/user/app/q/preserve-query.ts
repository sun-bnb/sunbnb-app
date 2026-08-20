/**
 * Carry a legacy QR URL's query string across its redirect (track 022).
 *
 * The old POS routes stay alive forever — cards are glued to loungers — and a
 * redirect that drops query params silently breaks whatever was riding on them.
 * Same reasoning and shape as the `/sites/[id]/dine/[tableId]` alias, which
 * learned it from mid-flight Mollie returns carrying `?tabReturn=`.
 */
export function preserveQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v)
    } else {
      qs.append(key, value)
    }
  }
  const query = qs.toString()
  return query ? `?${query}` : ''
}
