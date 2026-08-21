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

/**
 * The page title and description a bespoke shell claims for itself.
 *
 * A brand page that renders its own name in its own words should say the same
 * thing in the browser tab, the search result and the shared link. Left to the
 * platform, those come from `SiteBrand.brandName`/`tagline` — fields the shell
 * does not read, cannot see, and (under D2) the partner can no longer edit,
 * which is how "Platja d'Alcúdia" ended up titled "Alcúdia Beach Club".
 *
 * Deliberately plain data, in its own module per brand: `generateMetadata` runs
 * on the server, and reaching into the component to find a string would drag a
 * client module into the metadata path and undo the code splitting.
 *
 * The OG image is NOT here — that is `Site.image`, the cover the operator
 * uploads, and it stays theirs.
 */
export interface BrandMetadata {
  /** Browser tab, search result, shared link. Keep it the name the page shows. */
  title: string
  /** One sentence, under ~160 characters, written for someone who has not arrived yet. */
  description: string
}
