/**
 * Single-writer meta-guard (track 018, P2 slice b — determinism contract #2).
 *
 * Scans every app + this package for Prisma writes that mutate reservation
 * STATE — `reservation.update/updateMany` touching status / operationalStatus /
 * checkedInAt / departedAt, any `reservation.delete/deleteMany` (row lifecycle
 * IS state), and any `reservationDay` write (occupancy) — outside the sanctioned
 * machine modules.
 *
 * RATCHET SEMANTICS: `ALLOWLIST` snapshots the legacy call sites that predate
 * the machine. The test asserts EXACT equality:
 *   - a NEW state write anywhere fails the build (bypassing the machine is
 *     structurally impossible to do silently);
 *   - migrating an action (P4) reduces its count, which also fails until the
 *     allowlist entry is lowered/removed — the list only ever SHRINKS.
 * Target end state: ALLOWLIST === {}.
 *
 * Sanctioned writers (excluded — they ARE the machine / its effect executors):
 *   - packages/data/src/reservation-machine-apply.ts  (the interpreter)
 *   - packages/data/src/reservations.ts               (create/move conflict guards)
 *   - packages/data/src/payment.ts                    (pay.confirm executor)
 *   - packages/data/src/reservation-payment.ts        (pay.initiate/fail executors)
 *   - apps/partner/.../manage/reservation-day.ts      (day-row writer, delegates in P4)
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

const SCAN_ROOTS = [
  'apps/partner/app',
  'apps/user/app',
  'apps/admin/app',
  'packages/data/src',
]

const SANCTIONED = [
  'packages/data/src/reservation-machine-apply.ts',
  'packages/data/src/reservations.ts',
  'packages/data/src/payment.ts',
  'packages/data/src/reservation-payment.ts',
  'apps/partner/app/sites/[id]/manage/reservation-day.ts',
]

/**
 * Legacy state-write call sites, file → count. SHRINK-ONLY: lower/remove the
 * entry when you migrate an action onto applyTransition; never raise one.
 *
 * Snapshot 2026-08-11 (P2b). Note: frontdesk/actions.ts and partner
 * reservations/[id]/actions.ts were DISCOVERED BY THIS SCAN — they were absent
 * from the P0 de facto extraction (018-state-machine-defacto.md addendum).
 */
const ALLOWLIST: Record<string, number> = {
  // Cron GC keeps ONE bulk deleteMany — now I4-filtered (tillEntries none +
  // invoices none), so it can only ever touch zero-money rows. A per-row
  // applyTransition sweep would be correct but wasteful; the filter IS the rule.
  'apps/partner/app/api/reservations-cleanup/route.ts': 1,
  // P4 slice 2 (2026-08-11): frontdesk/actions.ts 4 → 0 and partner
  // reservations/[id]/actions.ts 4 → 0 — the D14/D15 fossils migrated onto
  // applyTransition (their parent-only writes and terminal-only depart deleted).
  // P4 slice 1 (2026-08-11): unreserveItem, markDeparted (whole+split),
  // splitWalkInSeat, checkInReservation migrated → 19 → 13. Slice e: the
  // collect flow (start/poll-revert/abandon) migrated → 13 → 8. Remaining:
  // convertHoldToWalkIn paths, blockBed/unblock/uncomp/releaseHold deletes,
  // refund/cancel — future P4 batches.
  'apps/partner/app/sites/[id]/manage/actions.ts': 8,
  'apps/user/app/api/reconcile/route.ts': 1, // payment_failed writer
  'apps/user/app/api/reservations/[id]/route.ts': 1, // payment_failed writer (poll)
  'apps/user/app/api/webhooks/mollie/route.ts': 3, // paid/failed/refund webhook writers
  'apps/user/app/payment/actions.ts': 1, // demo payment status writer
  'apps/user/app/reservations/[id]/actions.ts': 2, // user cancel + delete
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.next', '__mocks__', 'dist'])
const isTestFile = (f: string) => /\.(test|spec)\.tsx?$/.test(f)

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walk(path.join(dir, entry.name))
    } else if (/\.tsx?$/.test(entry.name) && !isTestFile(entry.name)) {
      yield path.join(dir, entry.name)
    }
  }
}

/** Slice the balanced-paren argument text of a call starting at `openParen`. */
function callText(source: string, openParen: number): string {
  let depth = 0
  for (let i = openParen; i < Math.min(source.length, openParen + 4000); i++) {
    const c = source[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return source.slice(openParen, i + 1)
    }
  }
  return source.slice(openParen, openParen + 4000)
}

const STATE_FIELD = /\b(status|operationalStatus|checkedInAt|departedAt)\s*:/

function countStateWrites(source: string): number {
  let count = 0

  // reservation.update/updateMany — count only when state fields are written
  const upd = /\.\s*reservation\s*\.\s*(update|updateMany)\s*\(/g
  for (let m = upd.exec(source); m; m = upd.exec(source)) {
    if (STATE_FIELD.test(callText(source, upd.lastIndex - 1))) count++
  }

  // reservation.delete/deleteMany — row lifecycle is state; always counts
  const del = /\.\s*reservation\s*\.\s*(delete|deleteMany)\s*\(/g
  for (let m = del.exec(source); m; m = del.exec(source)) count++

  // any reservationDay write — occupancy is state; always counts
  const day = /\.\s*reservationDay\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g
  for (let m = day.exec(source); m; m = day.exec(source)) count++

  return count
}

function scanRepo(): Record<string, number> {
  const found: Record<string, number> = {}
  for (const root of SCAN_ROOTS) {
    const abs = path.join(REPO_ROOT, root)
    if (!fs.existsSync(abs)) continue
    for (const file of walk(abs)) {
      const rel = path.relative(REPO_ROOT, file)
      if (SANCTIONED.includes(rel)) continue
      const n = countStateWrites(fs.readFileSync(file, 'utf8'))
      if (n > 0) found[rel] = n
    }
  }
  return found
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('reservation state machine — single-writer meta-guard (I5)', () => {
  it('sanctioned writer modules still exist (a rename would silently unsanction)', () => {
    for (const rel of SANCTIONED) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `missing sanctioned module: ${rel}`).toBe(true)
    }
  })

  it('reservation state writes outside the machine match the shrink-only allowlist exactly', () => {
    const found = scanRepo()
    // Exact equality both ways:
    //  - extra/raised entry ⇒ someone added a state write outside the machine → route
    //    it through applyTransition (@repo/data/reservation-machine-apply) instead;
    //  - missing/lowered entry ⇒ an action was migrated → shrink ALLOWLIST to match
    //    (this is the ratchet tightening — desired!).
    expect(found).toEqual(ALLOWLIST)
  })
})
