# Track 016 — Day-anchored till (per-day till the operator expects)

**Status:** active · **Surface:** `packages/data` + `apps/partner` (manage) · **Schema:** additive (`TillClose.carry_over_*`)
**Created:** 2026-07-23 · **Updated:** 2026-07-23 (P4) · **Worktree:** null

## Goal

The pilot beach operator (Alonso-trained) expects a **strictly per-day till**; our till is
"cash since your last close" — an event-boundary window that silently rolls across days.
Rework the till so **the venue-local day is the primary object**: every till number leads
with *today*, and unclosed cash from prior days surfaces as an explicit **carry-over**
bucket instead of merging invisibly. Keep the persistent `TillEntry` ledger (no
Alonso-style nightly wipe — persistent attribution is our upgrade over Alonso).

**Analysis basis (2026-07-23):** Alonso's till lifetime is hard-capped at one day (shift
close stamps `shiftClosedAt`; nightly day-reset wipes `rentalHistory`, revenue already
archived-as-you-go in `historicalStats`). No reopen exists — a closed shift is an immutable
partition; the next rental starts a fresh till at zero. Sunbnb already matches the
irreversible-partition semantics; the only divergence is the missing day boundary.
See `.claude/alonso/model/accounting-and-dayclose.md`.

**Decisions locked (2026-07-23, with the user):**
- **Sweep-together close.** A close (worker `closeTill` or admin `closeDay`) always sweeps
  today + carry-over as one handed-in amount — cash is never orphaned, no partial-close
  concept. The snapshot records the carry-over portion for audit.
- **No auto-close at midnight.** A `TillClose` is a human cash-handoff attestation; an
  unattended snapshot fakes a reconciliation nobody performed. Carry-over surfacing makes
  a forgotten close visible next morning instead. Revisit only on explicit operator ask.
- **Carry-over is one bucket** labeled with its oldest entry date (no per-day split; the
  day report answers per-day questions).

## Design

Per employee at a site (`@repo/data/till`):
- `lastClose` = latest `TillClose.closedAt` (or none); `dayStart` = venue-local start of
  today (computed by the **caller** via `siteDayBounds(buildSiteTimezone(site), now)` —
  till module stays tz-agnostic, mirroring `getTillDayReport`).
- `floor = max(lastClose, dayStart)` → **today** bucket: non-voided entries
  `settledAt > floor`. **carryOver** bucket: entries in `(lastClose, dayStart]`
  (empty when the worker already closed today).
- `total = today + carryOver` — identical to the current sweepable balance, so close
  semantics are unchanged.

```ts
interface OpenTill {
  total: number; count: number                    // sweepable — what close snapshots
  today: { total: number; count: number }
  carryOver: { total: number; count: number; oldestAt: Date | null }
}
```

- `dayStart: Date` becomes a **required** param on `getOpenTill`,
  `getOpenTillsByEmployee`, `getOpenTillItemsByEmployee` (items gain
  `carryOver: boolean`), `closeAllOpenTills`.
- New shared `closeEmployeeTill(siteId, employeeId, dayStart)` — single snapshot writer;
  today the worker close (`manage/actions.ts` `closeTill`, inline
  `prisma.tillClose.create`) and `closeAllOpenTills` are two divergent writers.
- Schema (additive, nullable): `TillClose.carryOverAmount Float? @map("carry_over_amount")`,
  `TillClose.carryOverCount Int? @map("carry_over_count")` — explains "today's closes ≠
  today's day report".
- Civil-day report fns (`getTillByEmployee`, `getEmployeeShiftItems`) unchanged.

Partner actions (same actions, same gates — auth-matrix registry untouched):
`getTillStatus`/`closeTill`/`getOpenTills`/`getOpenTillItems`/`closeDay` compute
`dayStart` and pass it; payloads grow `today`/`carryOver` (+ `carryOverClosed` on
`closeDay`). `__mocks__/@repo/data/till.ts` updated (mock-contract enforces).

UI: **TillSheet** leads with "Today: €X · N sales"; amber `role="status"` banner when
carry-over exists ("Uncounted cash from <date>: €Y — included when you close"); confirm +
closed receipt show the breakdown; `isEmpty` switches to `total === 0` (today can be €0
with closeable carry-over). **DailySummaryView** open-tills tab leads with today across
workers + amber carry-over chips per row. **DayCloseView** anchored to today's date;
post-close "Day closed — €X counted (€Y from previous days)". New i18n keys en/es/fi.

## Resume here

- **TRACK FUNCTIONALLY COMPLETE (2026-07-23, committed: 'Day-anchor the per-worker till' on local main).** All phases done:
  P1+P2 (data core + migration), P3 (partner actions), P4 (day-first UI), P4.5
  (summary header = close-independent daily accumulation), P5 (CLAUDE.md sync, wiki
  ingest into `subsystems/employee-till.md`, browser verification). Browser-verified
  end-to-end on Brisa Marina (local): seeded backdated TillEntries -> TillSheet led
  with "Today" + amber carry-over banner; midday close from `/manage/summary` left
  "TODAY'S CASH" **unchanged** while "Still uncounted" -> "Handed in today" shifted;
  post-close walk-in accumulated (header 9->18 across the close); day-report tab
  constant; `/manage/close` showed the carry-over portion pre-close and "9+10=19
  counted (10 from previous days)" post-close; `TillClose` rows carried
  `carry_over_amount`/`carry_over_count` exactly (30.5/21.5, 10/10, 9/0). Test rows
  cleaned up.
- **Next action: user ops, nothing to build.** (1) `npm run migrate:test` before any
  `main` push — pre-push hook enforces (additive migration
  `20260723140622_add_till_close_carry_over`). (2) Founder copy-review of the new
  en/es/fi `Till`/`TillSummary`/`DayClose` keys before `promote-to-test`
  (`.claude/rules/deploys.md` gate). (3) Push / promote / deploy at the user's
  discretion.
- **Context needed:** the Design section above (window math); `packages/data/src/till.ts`
  types; the three UI files below; `.claude/rules/deploys.md`'s translation-review gate
  (new copy needs a user read-through before `promote-to-test`, not before `commit`/`push`).
- **P4 shipped UI (for P5 context, not to re-derive)**: `TillSheet.tsx` leads with a
  `today` bucket (`€X` + `todaySalesCount`), an amber `role="status"` carry-over banner
  (`carryOverBanner`, shown whenever `carryOver.count > 0`, formats `carryOver.oldestAt`
  via `useLocale()` + `toLocaleDateString(locale, {day:'numeric',month:'short'})`), a
  confirm-step breakdown line (`confirmBreakdown`, today + carryOver = total) alongside
  the existing sweepable `confirmBody`, and a closed-receipt secondary line
  (`closedCarryOverNote`) when `closeTill`'s `carryOverAmount > 0`. `isEmpty` fixed to
  `total === 0` (was `count === 0`) so a €0-today worker with closeable carry-over still
  sees the Close button. `DailySummaryView.tsx` open-tills tab: header leads with
  `sum(today.total)`/`sum(today.count)` across workers (was sweepable `total`/`count`)
  plus a secondary amber line when `sum(carryOver.total) > 0`; per-worker row's big
  number is now `today.total` with an amber carry-over chip (`carryOverChip`) beside the
  sales-count line when that worker's `carryOver.count > 0`; itemized rows get an amber
  dot + `carryOverTag` label when `item.carryOver`. The close button/confirm text
  (`hasBalance`/`confirmBody`) stayed anchored to the sweepable `till.total` — unchanged,
  per the "what gets closed = sweepable" invariant. `DayCloseView.tsx`: header subtitle
  now reads `{siteName} · {todayLine: "Today, {date}"}` (formatted via a noon-UTC-anchored
  `toLocaleDateString`, same DST-safe technique as the server's `nominalNoon`); pre-close
  note gained a `carryOverPortion` line (sum of `getOpenTills` rows' `carryOver.total`);
  success state restructured from one `successTills` line (count + total) into
  `successAmount` ("{total} counted") + `successTills` (now count-only) +
  conditional `successCarryOverNote` using `closeDay`'s `carryOverClosed`. New state:
  `openTillsCarryOverTotal`, `carryOverClosed`. 22 new i18n keys total across `Till`
  (5) / `TillSummary` (3) / `DayClose` (5, plus the `successTills` param signature
  changed from `{count,total}` to `{count}`) — see the final report for the full
  English list; es/fi first-pass translations added in lockstep (verified via a
  Python key-diff script, not a repo test — none exists for i18n key parity).
  No new tests: none of the three files had a pre-existing test file, and per the
  task brief + repo convention (tests cover actions, not React trees) none was
  invented. `npx tsc --noEmit`, `npm run lint`, `npm run test` (1897 tests, 50
  files) all green — no server actions/mocks/schema touched.
- **2026-07-23** — P4.5 shipped (`DailySummaryView.tsx` only, uncommitted).
  Pilot-flagged residual bug: the open-tills header was still `sum(today.total)`
  (sweepable, since-last-close) so a worker's cash vanished from the header on a
  midday close. Fixed by fetching `getTillDayReport(siteId, todayIso(), accessKey)`
  (close-independent civil-day report, already imported/used by the day tab)
  alongside `getOpenTillItems` in `loadOpenTills` and `handleCloseEmployee`'s
  refresh; header now leads with `sum(dayReport.total)`/`sum(dayReport.count)`.
  Added a reconciliation breakdown under the header: "Still uncounted"
  (`sum(tills.today.total)`) and "Handed in today" (`dayTotal − uncounted`,
  clamped ≥0, `round2`'d) — both shown only when > 0 — so the header staying
  constant across a close while the rows repartition is explained, not silently
  inconsistent. Amber carry-over line unchanged. No server actions/mocks/schema/
  `TillSheet`/`DayCloseView` touched — `getTillDayReport` was already
  exported+imported here from P3, just unused. 2 new i18n keys
  (`TillSummary.stillUncounted`/`handedInToday`), en/es/fi in lockstep. No new
  tests (no pre-existing test file for this component; repo convention). Full
  verify green: `tsc --noEmit` clean, lint clean (pre-existing warnings only),
  1897 unit tests (50 files, unchanged count).
- **Blocked by:** nothing.

## Roadmap

- **P1 — till module rework** (`packages/data`) — DONE 2026-07-23. Two-bucket window
  math (`getOpenTill`/`getOpenTillsByEmployee`/`getOpenTillItemsByEmployee` all take
  required `dayStart`), new `OpenTill`/`EmployeeTill`/`EmployeeOpenTill` shapes,
  `carryOver` flags on items, `closeEmployeeTill` (shared snapshot writer),
  `closeAllOpenTills` rebuilt on top of it (`carryOverClosed` added to its return).
  `getTillByEmployee`/`getEmployeeShiftItems` (civil-day reports) deliberately
  unchanged — kept on a separate `EmployeeCashTotal` type. 79 integration tests (was
  72), all green; 265 unit tests green (till has none); lint clean.
- **P2 — additive migration** — DONE 2026-07-23. `carry_over_amount`/`carry_over_count`
  (both nullable) on `TillClose`; migration
  `20260723140622_add_till_close_carry_over`, pure `ADD COLUMN`. Applied to local DB
  and `sunbnb_test` (`migrate:local`'s lockstep step). **`migrate:test` still pending**
  before pushing `main` (pre-push hook will block it).
- **P3 — partner action layer** — DONE 2026-07-23. `getTillStatus`/`closeTill`/
  `getOpenTills`/`getOpenTillItems`/`closeDay` in
  `apps/partner/app/sites/[id]/manage/actions.ts` all compute
  `dayStart = (await siteTodayBounds(siteId)).start` (reused the pre-existing helper
  rather than inlining `siteDayBounds(buildSiteTimezone(site), new Date())`) and thread
  it through; `closeTill`'s inline `prisma.tillClose.create` replaced with
  `closeEmployeeTill(siteId, valid, dayStart)`. Payloads grew `today`/`carryOver` (+
  `carryOverAmount`/`carryOverCount` on `closeTill`, `carryOverClosed` on `closeDay`).
  `getTillDayReport`'s declared return type fixed from `EmployeeTill[]` to
  `EmployeeCashTotal[]` (its real source, `getTillByEmployee`, was split onto that type
  in P1 — this function was otherwise untouched, still the civil-day report).
  `__mocks__/@repo/data/till.ts` updated: added `closeEmployeeTill`, zeroed
  `today`/`carryOver` on default resolved values. Auth gates untouched — auth-matrix
  registry needed no membership changes. 9 new/updated unit tests, 1 integration test
  added (day-anchored carry-over sweep through `closeDay` end-to-end) + 2 existing
  integration tests strengthened with bucket assertions. Full verify green: `tsc
  --noEmit` clean, lint clean, 1897 unit tests (50 files), 179 integration tests
  (8 files). One UI file (`DayCloseView.tsx`) needed a type-only import rename
  (`EmployeeTill` → `EmployeeCashTotal`) to keep monorepo typecheck green — no
  rendering/behavior change; left for the record so P4 doesn't re-discover it.
- **P4 — UI** — DONE 2026-07-23. `TillSheet.tsx` / `DailySummaryView.tsx` /
  `DayCloseView.tsx` reframed day-first (details in Resume here). 22 new i18n keys
  across `Till`/`TillSummary`/`DayClose`, en/es/fi in lockstep. No server actions,
  mocks, or schema touched — pure UI + i18n. Full verify green (`tsc --noEmit`,
  lint, 1897 unit tests / 50 files — unchanged counts, since the surface has no
  component tests by repo convention). English copy still needs the user's
  translation-review pass (`.claude/rules/deploys.md`) before any `promote-to-test`.
- **P4.5 — fix the open-tills header to lead with true daily accumulation** —
  DONE 2026-07-23. Pilot feedback surfaced a residual bug P4 didn't catch: the
  `DailySummaryView` open-tills header summed `today.total` across workers —
  still a **sweepable** (since-last-close) bucket, so a worker's cash vanished
  from the header the moment they closed mid-shift. Fixed by fetching
  `getTillDayReport(siteId, todayIso(), accessKey)` (the close-independent
  civil-day report, already used by the day tab) alongside `getOpenTillItems`
  and pointing the header at its sum instead. Added a reconciliation
  breakdown under the header — "Still uncounted" (sum of tills' `today.total`,
  cash on the floor not yet swept) and "Handed in today" (day total minus
  uncounted, clamped ≥0) — so the header-vs-rows gap after a close is
  explained rather than silently inconsistent. The old amber carry-over line
  (pre-today cash) is unchanged and unaffected. Per-worker rows, itemized
  lists, and `openTillsNote` copy are untouched — verified the note ("Closing
  sweeps in all uncounted cash…") still accurately describes the close action
  and doesn't conflict with the new header framing. 2 new i18n keys
  (`TillSummary.stillUncounted`, `TillSummary.handedInToday`), en/es/fi in
  lockstep (verified via a one-off Node key-diff, not a repo test). No server
  actions, mocks, schema, `TillSheet`, or `DayCloseView` touched — `getTillDayReport`
  was already exported/imported in this file (P3), just unused until now. No
  new tests (component has no pre-existing test file; repo convention is
  actions, not React trees). Full verify green: `tsc --noEmit` clean, lint
  clean (pre-existing unrelated warnings only), 1897 unit tests (50 files,
  unchanged count). English copy needs the user's translation-review pass
  before `promote-to-test`.
- **P5 — docs & verify**: partner/data CLAUDE.md sync, wiki ingest, browser-verify via
  `verifier-sunbnb` (worker close midday → fresh till; seeded yesterday-cash → carry-over
  banner → close sweeps both; **plus** the P4.5 fix: open-tills header total stays constant
  across a midday close while "Still uncounted"/"Handed in today" shift).

## Open decisions (defaults chosen; flag to revisit)

- Auto-close cron at day end — **rejected** (see locked decisions); revisit on operator ask.
- Whether `/manage/close` should also show the civil-day report inline (it already has
  tabs at `/manage/summary`) — default: show day total + sweep breakdown only.

## Links

- [[track:008-employee-model]] — built the Employee roster + `TillClose` this reworks.
- [[track:013-settlement-ledger-till]] — the `TillEntry` ledger this window math reads.
- [[track:006-alonso-staff-ui]] — customer-parity feedback lineage; same pilot operator.
- `.claude/alonso/model/accounting-and-dayclose.md` — Alonso till-lifetime analysis.

## Log

- **2026-07-23** — Track created from till-lifetime analysis (Alonso vs Sunbnb). Pilot
  operator confused by since-last-close semantics ("open till" ≠ "today's cash"; no day
  object; event- vs civil-day windows mixed on summary screens). Design locked:
  day-anchored two-bucket window (today + visible carry-over), sweep-together close,
  carry-over recorded on `TillClose` (additive migration), no auto-close, no data wipe.
  Confirmed in the Alonso bundle that closes are irreversible (single `shiftClosedAt`
  write site, no un-close path) — matches our TillClose partitions.
- **2026-07-23** — P1+P2 shipped (`packages/data` only, uncommitted). `src/till.ts`
  reworked to the two-bucket model (`getOpenTill`/`getOpenTillsByEmployee`/
  `getOpenTillItemsByEmployee` take required `dayStart`; new `closeEmployeeTill` shared
  snapshot writer; `closeAllOpenTills` rebuilt on it, returns `carryOverClosed`).
  Additive migration `20260723140622_add_till_close_carry_over`
  (`TillClose.carry_over_amount`/`carry_over_count`, nullable) applied to local +
  `sunbnb_test`. `till.integration.test.ts` fully reworked: 79 tests (was 72), all
  green; unit suite (265) and lint unaffected. Kept `getTillByEmployee`/
  `getEmployeeShiftItems` genuinely unchanged by splitting a separate
  `EmployeeCashTotal` type rather than reusing the now-bucketed `EmployeeTill`.
  `migrate:test` still pending (blocks a `main` push per the pre-push hook). P3
  (partner action layer) is next — see Resume here.
- **2026-07-23** — P3 shipped (`apps/partner` only, uncommitted, coordinated with the
  already-uncommitted P1-P2). `manage/actions.ts`: `getTillStatus`/`closeTill`/
  `getOpenTills`/`getOpenTillItems`/`closeDay` all thread a site-derived `dayStart`
  through to the reworked `@repo/data/till` signatures; `closeTill` now delegates to
  `closeEmployeeTill` instead of an inline `prisma.tillClose.create`. `getTillDayReport`
  retyped to `EmployeeCashTotal[]` (matches P1's split, function itself untouched).
  `__mocks__/@repo/data/till.ts` gained `closeEmployeeTill` + zeroed bucket defaults
  (`mock-contract.test.ts` green). One UI file, `DayCloseView.tsx`, needed a type-only
  import fix (`EmployeeTill`→`EmployeeCashTotal`) to keep typecheck green — no
  behavior/rendering change, left for P4. New unit tests: `getTillStatus`/`closeTill`
  describe blocks (previously untested at the unit level — only integration + the
  generic auth-matrix covered them) plus dayStart-forwarding and carryOverClosed
  assertions on `getOpenTills`/`closeDay`. New integration test: `closeDay` sweeping a
  genuinely-backdated (pre-`dayStart`) TillEntry as carry-over end-to-end through the
  partner action. Full verify green: `tsc --noEmit`, lint, 1897 unit tests (50 files,
  was 1888), 179 integration tests (8 files). `migrate:test` still pending from P2 —
  must run before any `main` push (pre-push hook enforces). P4 (UI reframing + i18n) is
  next — see Resume here for exact payload shapes to consume.
- **2026-07-23** — P4 shipped (`apps/partner` UI only, uncommitted, on top of the
  already-uncommitted P1-P3). `TillSheet.tsx`: lead switched from the sweepable
  "Open till" to `today` (`€X` + today's sales count); amber `role="status"`
  carry-over banner when `carryOver.count > 0`; confirm-step breakdown line
  (today + carryOver = total) alongside the unchanged sweepable `confirmBody`;
  closed-receipt secondary carry-over line. Fixed the `isEmpty` bug named in the
  track brief: `count === 0` → `total === 0`, so a worker with €0 today but
  closeable carry-over still sees the Close button. `DailySummaryView.tsx`
  (open-tills tab): header total/count switched to `sum(today.total)`/
  `sum(today.count)` across the roster (was sweepable), with a secondary amber
  "+ €Y carried over" line; per-worker row's headline number is now `today.total`
  with an amber carry-over chip beside the sales-count line; itemized rows get an
  amber dot + tag when `item.carryOver`. Day-report tab untouched (own,
  deliberately non-bucketed `EmployeeCashTotal` type). Close button/confirm text
  stayed anchored to the sweepable `till.total` per the "what gets closed =
  sweepable" invariant — the one deliberate design call not spelled out
  verbatim in the brief (grandCount/row headline for 'today' vs. keeping
  employeeSalesCount tied to sweepable — resolved by re-pointing the count to
  `today.count` too, so the paired total+count reads consistently). `DayCloseView.tsx`:
  subtitle reframed to "{siteName} · Today, {date}" (noon-UTC-anchored format,
  DST-safe); pre-close note gained a carry-over-portion line (sum of `getOpenTills`
  rows' `carryOver.total`); success state restructured into a prominent
  "{total} counted" line + till-count line + conditional "(€Y from previous
  days)" using `closeDay`'s `carryOverClosed`. 22 new i18n keys across
  `Till`/`TillSummary`/`DayClose` (en/es/fi in lockstep, verified via a one-off
  Python key-diff, not a repo test) — `TillSummary.successTills`'s param
  signature narrowed from `{count,total}` to `{count}` (total now shown via the
  new `successAmount` key) — a deliberate breaking change to an existing key,
  safe because it's a UI-only concern. No new component tests (none of the
  three files had pre-existing test files; per the task brief and repo
  convention — tests cover actions, not React trees — none was invented).
  No server actions, mocks, or schema touched. Full verify green: `tsc --noEmit`
  clean, lint clean (only pre-existing unrelated warnings), 1897 unit tests
  (50 files, unchanged count). English copy needs the user's translation-review
  pass (`.claude/rules/deploys.md`) before any `promote-to-test`. P5 (docs sync +
  wiki ingest + browser-verify) is next — see Resume here.
