# Track Registry

The control plane — every track, its state, and where to resume. **Start here.**
Maintained by the `create` and `handoff` workflows.

## Active

| ID | Track | Next action | Worktree | Updated |
|----|-------|-------------|----------|---------|
| [001](001-knowledge-store.md) | Knowledge Store | Phase 1 — stand up Vercel test-env log-drain adapter | — | 2026-05-20 |
| [002](002-table-reservations.md) | Table Reservations | P1 complete (1a–1h) + pick-your-spot (`71c75e7`, committed local). **Next: `migrate:test` then push** (additive migration pending Neon TEST DB); then browser-verify, P2 live floor | — | 2026-05-27 |
| [004](004-partner-test-architecture.md) | Partner Test Architecture | **PARTNER SCOPE COMPLETE** (Phases 0/3/1/4 — spine, fixes, backfill, cleanup+coverage-ratchet; 901 unit + 89 integration green, full gate green). Phase 1+4 local (`d4621b0`→`8386e7b`, 6 unpushed). Deferred: @repo/test-utils extraction, createWalkInRental race. | — | 2026-06-17 |
| [006](006-alonso-staff-ui.md) | Alonso → Staff UI Migration | **FUNCTIONALLY COMPLETE & LIVE** (P1–P8 + multiselect + refund + dark/zoom, on test+prod). **Floor-state half of the Alonso gap closed.** ES/FI copy reviewed (2026-06-19). Backlog spun out: analytics → [007](007-operator-analytics.md); per-staff cash close = [008](008-employee-model.md). | — | 2026-06-19 |
| [008](008-employee-model.md) | Employee Model — staff attribution & till | **Phase 1 next — schema** (`Employee` per-account + `TillClose` + `employeeId` FK on Reservation/RentalBooking, additive) → `migrate:local`, thread `employeeId` through the create helpers, walk-in cash amount, `till.ts` aggregation, mocks, tests. Then roster+chip (P2), till+close (P3), accounting breakdown (P4). Alonso "Group A". | — | 2026-06-19 |

## Proposed / backlog

| ID | Track | Why deferred | Updated |
|----|-------|--------------|---------|
| [003](003-stripe-connect-compliance.md) | Stripe Connect compliance | **Green-field — consumer Stripe code removed (2026-05-23).** Stripe is subs-only; consumer = Mollie + Demo. Build on Connect from scratch if/when consumer Stripe is reintroduced. | 2026-05-23 |

## Done / archived

| ID | Track | Outcome | Updated |
|----|-------|---------|---------|
| [007](007-operator-analytics.md) | Operator Analytics & Exports | **Done.** Alonso "Group B" shipped on the per-site accounting page: `@repo/data/analytics` (5 helpers) + 3 gated actions; rolling revenue lens (B2) + comp/occupancy (B1) + CSV export (B3). data 192 + 2 integration, partner 1427 green; pushed, preview `next build` Ready. ES/FI copy reviewed. | 2026-06-19 |
| [005](005-alonso-beach-model.md) | Alonso Beach App Model | **Done — all 7 phases.** Full functional model of the Alonso Beach competitor app in `.claude/alonso/` (6 subsystem docs + `synthesis-sunbnb.md` payload). Reference for Sunbnb manage-page/accounting design; floor-ops layer flagged as Sunbnb's biggest gap. Wiki promotion deferred (promote on use). | 2026-06-17 |
