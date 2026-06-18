# Track Registry

The control plane — every track, its state, and where to resume. **Start here.**
Maintained by the `create` and `handoff` workflows.

## Active

| ID | Track | Next action | Worktree | Updated |
|----|-------|-------------|----------|---------|
| [001](001-knowledge-store.md) | Knowledge Store | Phase 1 — stand up Vercel test-env log-drain adapter | — | 2026-05-20 |
| [002](002-table-reservations.md) | Table Reservations | P1 complete (1a–1h) + pick-your-spot (`71c75e7`, committed local). **Next: `migrate:test` then push** (additive migration pending Neon TEST DB); then browser-verify, P2 live floor | — | 2026-05-27 |
| [004](004-partner-test-architecture.md) | Partner Test Architecture | **PARTNER SCOPE COMPLETE** (Phases 0/3/1/4 — spine, fixes, backfill, cleanup+coverage-ratchet; 901 unit + 89 integration green, full gate green). Phase 1+4 local (`d4621b0`→`8386e7b`, 6 unpushed). Deferred: @repo/test-utils extraction, createWalkInRental race. | — | 2026-06-17 |
| [006](006-alonso-staff-ui.md) | Alonso → Staff UI Migration | **FUNCTIONALLY COMPLETE & LIVE** (P1–P8 + multiselect + refund + dark/zoom, on test+prod). **Floor-state half of the Alonso gap closed.** Remaining: ES/FI copy review (`SiteManage`/`BedDetail` machine translations) before further promotes. Backlog spun out: analytics → [007](007-operator-analytics.md); per-staff cash close = future "Group A" track. | — | 2026-06-18 |
| [007](007-operator-analytics.md) | Operator Analytics & Exports | **Phase 1 next — `@repo/data/analytics.ts` helpers** (`getRevenueByDay`/`summarizeRevenue`/`getOccupancyByDay`/`toFiguresCsv`) + tests; then B2 rolling lens (dashboard), B1 comp/occupancy (accounting), B3 CSV export. Low-effort half of Alonso "Group B". No schema change. | — | 2026-06-18 |

## Proposed / backlog

| ID | Track | Why deferred | Updated |
|----|-------|--------------|---------|
| [003](003-stripe-connect-compliance.md) | Stripe Connect compliance | **Green-field — consumer Stripe code removed (2026-05-23).** Stripe is subs-only; consumer = Mollie + Demo. Build on Connect from scratch if/when consumer Stripe is reintroduced. | 2026-05-23 |

## Done / archived

| ID | Track | Outcome | Updated |
|----|-------|---------|---------|
| [005](005-alonso-beach-model.md) | Alonso Beach App Model | **Done — all 7 phases.** Full functional model of the Alonso Beach competitor app in `.claude/alonso/` (6 subsystem docs + `synthesis-sunbnb.md` payload). Reference for Sunbnb manage-page/accounting design; floor-ops layer flagged as Sunbnb's biggest gap. Wiki promotion deferred (promote on use). | 2026-06-17 |
