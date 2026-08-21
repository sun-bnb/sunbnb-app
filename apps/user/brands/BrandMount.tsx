'use client'

import { BRAND_MODULES } from './registry'
import type { BrandPageProps } from './types'

/**
 * Client boundary for bespoke brand modules (track 023 P3).
 *
 * `next/dynamic` only produces a per-module chunk when the dynamic call sits in
 * CLIENT code. Called from a server component it degrades to a plain lazy
 * reference, and every brand ends up in the route's client bundle — measured,
 * see the registry's note.
 */
export default function BrandMount({
  brandKey,
  ...props
}: BrandPageProps & { brandKey: keyof typeof BRAND_MODULES }) {
  const BrandPage = BRAND_MODULES[brandKey]
  return <BrandPage {...props} />
}
