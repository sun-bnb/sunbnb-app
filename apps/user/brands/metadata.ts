/**
 * Page metadata per brand (track 023 Q9).
 *
 * Separate from `registry.ts` on purpose. That map is a `next/dynamic` client
 * boundary — the thing that gives each brand its own chunk. `generateMetadata`
 * runs on the SERVER for every request, so it must not touch that path; pulling
 * a component in to read a title would put every brand back in the shared
 * bundle.
 *
 * These imports are static rather than lazy, and that is fine: each entry is
 * two strings, needed on every render of the page, with no component behind it.
 */

import type { BrandKey } from '@repo/data/brand-manifest'

import { metadata as alcudia } from './alcudia/meta'
import { metadata as reference } from './reference/meta'
import type { BrandMetadata } from './types'

export const BRAND_METADATA: Record<BrandKey, BrandMetadata> = {
  reference,
  alcudia,
}
