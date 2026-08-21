/**
 * Alcúdia brand module — smoke contract (track 023 P5).
 *
 * Rendering the module under vitest is blocked the same way the registry's
 * thunk-await was: it mounts BookingSurface, which reaches next-auth, which
 * does not load in the node test environment. tsc already guarantees the
 * component satisfies BrandPageProps, so what is left for a test is the brand
 * KIT — the obligations a bespoke shell must not quietly drop, asserted
 * against the source the way the registry's dynamic() guard is.
 */

import { readFileSync } from 'node:fs'

import { describe, it, expect } from 'vitest'

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

describe('alcudia brand module', () => {
  it('mounts the platform booking funnel rather than rebuilding it', () => {
    // The whole custom-shell/shared-engine bargain. A shell that copies the
    // drawer inherits a copy that stops matching the day the engine changes.
    expect(source).toContain("import BookingSurface from '@/components/booking/BookingSurface'")
    expect(source).toMatch(/<BookingSurface\s[^>]*site=\{site\}/)
    expect(source).toMatch(/<BookingSurface\s[^>]*apiKey=\{apiKey\}/)
  })

  it('is a client component — the registry code-splits through a client boundary', () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(true)
  })

  it('renders the working hours from data, not from copy', () => {
    expect(source).toContain('site.workingHours')
  })

  it('prices from the site payload, never a hardcoded euro amount', () => {
    expect(source).toContain('site.price')
    // A literal like €9.10 in copy would silently go stale on the next tariff.
    expect(source).not.toMatch(/€\s?\d/)
  })

  it('carries the cover photo attribution — the licence requires it to travel', () => {
    expect(source).toContain('Bengt Nyman')
    expect(source).toContain('creativecommons.org/licenses/by/3.0')
  })

  it('respects reduced motion', () => {
    expect(source).toContain('prefers-reduced-motion')
  })
})
