/**
 * The brand registry (track 023).
 *
 * Most of this file's safety is already static: `Record<BrandKey, …>` makes the
 * shared manifest and this map check each other at compile time, and
 * `import('@/brands/…')` is itself typechecked, so a wrong path or a module
 * whose default export does not match `BrandPageProps` fails `tsc`.
 *
 * What is left for a test is the agreement between the two lists at RUNTIME —
 * the manifest is what the partner and admin apps read, and they cannot import
 * this file — and the shape of the entries, since the code-splitting the whole
 * design rests on depends on them staying thunks.
 *
 * Deliberately NOT tested here: awaiting a thunk to confirm it resolves. The
 * modules pull in the booking surface and, through it, next-auth, which does not
 * load under vitest's node environment. `tsc` covers the same ground.
 */

import { readFileSync } from 'node:fs'

import { describe, it, expect } from 'vitest'

import { BRAND_KEYS } from '@repo/data/brand-manifest'
import { BRAND_MODULES } from './registry'

describe('BRAND_MODULES', () => {
  it('has an entry for every key in the shared manifest, and no others', () => {
    // The manifest is what the partner and admin apps read; they cannot import
    // this file, so a disagreement would show up as "admin says live, the site
    // renders standard" with nothing to explain it.
    expect(Object.keys(BRAND_MODULES).sort()).toEqual([...BRAND_KEYS].sort())
  })

  it('wraps every entry in next/dynamic — this is what code-splits the brands', () => {
    // A SOURCE check, because the thing it guards cannot be seen from a unit
    // test. Measured at build time: a bare `() => import(…)` awaited in a server
    // component puts every brand in `/s/[slug]`'s page chunk, and so does
    // next/dynamic called from server code. Only a dynamic() reached through a
    // client boundary (BrandMount) emits one chunk per brand — verified by
    // rebuilding with two brands and finding them in separate chunk files.
    //
    // Swapping any entry back to a static import or a bare thunk would compile,
    // pass every other test, and quietly ship every customer's design to every
    // guest of every branded site.
    const source = readFileSync(new URL('./registry.ts', import.meta.url), 'utf8')

    expect(source).toContain("import dynamic from 'next/dynamic'")
    for (const key of BRAND_KEYS) {
      expect(source).toMatch(new RegExp(`${key}:\\s*dynamic\\(`))
    }
  })
})
