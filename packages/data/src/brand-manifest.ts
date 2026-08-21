/**
 * Which sites have a bespoke brand page, and whether it is serving (track 023).
 *
 * PURE and client-safe — no prisma, no React. That matters because three
 * surfaces need the same answer and they live in different apps:
 *
 *   - the user app picks which page to render;
 *   - the partner brand tab decides whether to offer the token editor at all
 *     (D2: a field is exposed iff it is still in effect);
 *   - the admin switch reports whether a site is LIVE or merely enabled.
 *
 * The React modules themselves live in `apps/user/brands`, which the other two
 * apps cannot import. So the LIST lives here and the modules stay there, with a
 * test pinning them to each other in both directions. Same argument as
 * `unit-address`: parties that must agree about one fact should not each derive
 * it.
 */

/**
 * Every brand module that exists in `apps/user/brands/<key>`.
 *
 * The key is the join between a customer's design and their Site row, and it is
 * deliberately NOT `Site.code`: codes are minted per database, so the same venue
 * has different ones in dev, test and production, and a registry committed
 * against one would resolve nowhere else — including the Vercel previews that
 * run against the test DB. A key in code plus a pointer per environment also
 * lets one module serve a chain of sites.
 *
 * Adding a brand: create `apps/user/brands/<key>/index.tsx`, add the key here,
 * and register the import in that app's registry. The registry test fails if any
 * of the three drifts from the others.
 */
export const BRAND_KEYS = ['reference'] as const

export type BrandKey = (typeof BRAND_KEYS)[number]

export function isKnownBrandKey(key: string | null | undefined): key is BrandKey {
  return !!key && (BRAND_KEYS as readonly string[]).includes(key)
}

/** Why a site is or is not showing a bespoke page — surfaced in the admin UI. */
export type BrandRenderReason =
  /** Serving a bespoke page. */
  | 'live'
  /** A module is assigned but the switch is off — merged and dark, on purpose. */
  | 'disabled'
  /** The switch is on but no module is assigned yet. */
  | 'no-key'
  /** A key is assigned that no module answers to — a typo, or a deleted module. */
  | 'unknown-key'

export interface BrandRenderInput {
  customBrandEnabled?: boolean | null
  customBrandKey?: string | null
}

export interface BrandRender {
  mode: 'custom' | 'standard'
  key: BrandKey | null
  reason: BrandRenderReason
}

/**
 * The ONE answer to "what does a guest see", used by every surface.
 *
 * Both gates must pass. Anything else resolves to the standard page rather than
 * to an error: a bespoke page that is missing, misconfigured or switched off
 * must cost the customer their design, not their bookings.
 *
 * The `reason` is the interesting half for operators — "enabled but no module
 * assigned" and "assigned a key nothing answers to" are very different problems,
 * and a bare boolean cannot tell them apart.
 */
export function resolveBrandRender(site: BrandRenderInput): BrandRender {
  const key = site.customBrandKey?.trim() || null

  if (!key) {
    return { mode: 'standard', key: null, reason: site.customBrandEnabled ? 'no-key' : 'disabled' }
  }
  if (!isKnownBrandKey(key)) {
    return { mode: 'standard', key: null, reason: 'unknown-key' }
  }
  if (!site.customBrandEnabled) {
    return { mode: 'standard', key, reason: 'disabled' }
  }
  return { mode: 'custom', key, reason: 'live' }
}
