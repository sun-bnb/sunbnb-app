/**
 * Guard tests for the destructive scale-fixture seeder (track 020 P0).
 *
 * These are requirements-driven, not implementation-mirroring: each case names
 * a database an operator could plausibly point the seeder at by accident, and
 * asserts it is refused. The two that matter most are `sunbnb_test` (wiping it
 * mid-suite would produce baffling test failures) and any Neon host (wiping
 * production). Both are asserted to survive `--force`, because the realistic
 * accident is someone adding `--force` to get past the first refusal.
 */

import { describe, it, expect } from 'vitest'
import {
  assertSafeTarget,
  maskDbUrl,
  DEFAULT_DATABASE,
} from './scale-fixture-guard'

const local = (db: string) => `postgres://postgres:sunbnb@localhost:5432/${db}`

describe('assertSafeTarget', () => {
  describe('accepts', () => {
    it('the default benchmark database with no flags', () => {
      const { database } = assertSafeTarget(local(DEFAULT_DATABASE))
      expect(database).toBe('sunbnb_scale')
    })

    it('127.0.0.1 as well as localhost', () => {
      expect(() =>
        assertSafeTarget(`postgres://postgres:sunbnb@127.0.0.1:5432/${DEFAULT_DATABASE}`)
      ).not.toThrow()
    })

    it('the postgresql:// protocol alias', () => {
      expect(() =>
        assertSafeTarget(`postgresql://postgres:sunbnb@localhost:5432/${DEFAULT_DATABASE}`)
      ).not.toThrow()
    })
  })

  describe('refuses the integration-test database', () => {
    // The sharpest edge: the integration suites own sunbnb_test and TRUNCATE it
    // between files. A fixture seeded there is both destroyed and destructive.
    it('without --force', () => {
      expect(() => assertSafeTarget(local('sunbnb_test'))).toThrow(/sunbnb_test/)
    })

    it('WITH --force — the allowlist is not overridable', () => {
      expect(() => assertSafeTarget(local('sunbnb_test'), { force: true })).toThrow(
        /not on the allowlist/
      )
    })
  })

  describe('refuses the local dev database', () => {
    it('without --force', () => {
      expect(() => assertSafeTarget(local('postgres'))).toThrow(/without --force/)
    })

    it('WITH --force', () => {
      expect(() => assertSafeTarget(local('postgres'), { force: true })).toThrow(
        /not on the allowlist/
      )
    })
  })

  describe('refuses remote hosts even when the database name is allowlisted', () => {
    const remotes = [
      'postgres://u:p@ep-cool-name-123456.eu-central-1.aws.neon.tech/sunbnb_scale',
      'postgres://u:p@db.example.com:5432/sunbnb_scale',
      'postgres://u:p@10.0.0.5:5432/sunbnb_scale',
    ]

    for (const url of remotes) {
      it(`rejects ${new URL(url).hostname}`, () => {
        expect(() => assertSafeTarget(url, { force: true })).toThrow(/non-local host/)
      })
    }
  })

  describe('refuses malformed targets', () => {
    it('undefined', () => {
      expect(() => assertSafeTarget(undefined)).toThrow(/not set/)
    })

    it('empty string', () => {
      expect(() => assertSafeTarget('')).toThrow(/not set/)
    })

    it('a non-URL', () => {
      expect(() => assertSafeTarget('not-a-url')).toThrow(/not a valid URL/)
    })

    it('a non-postgres protocol', () => {
      expect(() => assertSafeTarget('mysql://root@localhost:3306/sunbnb_scale')).toThrow(
        /protocol/
      )
    })

    it('a URL naming no database', () => {
      expect(() => assertSafeTarget('postgres://postgres:sunbnb@localhost:5432/')).toThrow(
        /names no database/
      )
    })
  })

  it('respects a caller-supplied allowlist', () => {
    expect(() =>
      assertSafeTarget(local('my_bench'), {
        allowedDatabases: ['my_bench'],
        defaultDatabase: 'my_bench',
      })
    ).not.toThrow()
  })
})

describe('maskDbUrl', () => {
  it('strips credentials', () => {
    const { url } = assertSafeTarget(local(DEFAULT_DATABASE))
    const masked = maskDbUrl(url)
    expect(masked).toBe('postgres://localhost:5432/sunbnb_scale')
    // The fixture password happens to be "sunbnb", which is also a substring of
    // the database name — assert on the credentials segment, not the word.
    expect(masked).not.toContain('@')
    expect(masked).not.toContain('postgres:sunbnb')
  })
})
