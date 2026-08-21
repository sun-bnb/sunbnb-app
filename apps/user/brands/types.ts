/**
 * What a bespoke brand module is handed (track 023).
 *
 * Deliberately small. A brand shell owns its own layout, type and copy, so the
 * platform gives it the DATA and one supported mount point, not a theme:
 * `SiteBrand`'s colour tokens are not passed, because under a custom page they
 * are not in effect (D2) and a shell that read them would be pretending they
 * were.
 *
 * Everything else a shell needs it can import — it lives inside `apps/user` for
 * exactly that reason (D3). What it must NOT do is re-implement the booking
 * funnel: mount `components/booking/BookingSurface` instead, so an engine change
 * reaches every shell at once.
 */

import type { SiteProps } from '@/app/sites/types'

export interface BrandPageProps {
  /** The site, loaded exactly as the standard branded page loads it. */
  site: SiteProps
  /** Google Maps client key, for the seat map inside the booking surface. */
  apiKey: string
  /** Seats free today, server-computed; the funnel falls back to it while its own query resolves. */
  initialAvailableCount?: number
}
