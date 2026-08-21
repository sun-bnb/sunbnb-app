/**
 * Which module renders which brand (track 023).
 *
 * **This map is the reason bespoke pages are code-split**, and the mechanism is
 * load-bearing rather than incidental. A bare `() => import(…)` thunk awaited in
 * a server component does NOT split on the client: the module is a client
 * component reached from the route's graph, so Next bundles it into
 * `/s/[slug]`'s page chunk and every guest downloads every customer's design.
 * Measured, not assumed — the first version of this file did exactly that.
 *
 * `next/dynamic` is what actually emits a per-brand chunk. Two further ways to
 * silently undo it, both easy to write:
 *
 *   - a template-literal path — `import(`@/brands/${key}`)` cannot be
 *     enumerated at build time, so nothing splits;
 *   - a barrel `brands/index.ts` re-exporting the modules — one static import of
 *     it pulls all of them in and this map becomes decoration.
 *
 * If this ever needs changing, rebuild and grep `.next/static/chunks` for a
 * string unique to one brand: it must appear in its OWN chunk and never in
 * `app/s/[slug]/page-*.js`.
 *
 * Typing it as `Record<BrandKey, …>` makes the manifest and this file check each
 * other at COMPILE time: a key added to `@repo/data/brand-manifest` without an
 * import here fails to typecheck, and an import here for a key that is not in
 * the manifest fails too. The manifest is what the partner and admin apps read;
 * they cannot import this file, and they must not disagree with it.
 */

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import type { BrandKey } from '@repo/data/brand-manifest'

import type { BrandPageProps } from './types'

export const BRAND_MODULES: Record<BrandKey, ComponentType<BrandPageProps>> = {
  reference: dynamic(() => import('@/brands/reference')),
  alcudia: dynamic(() => import('@/brands/alcudia')),
}
