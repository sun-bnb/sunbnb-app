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
| [008](008-employee-model.md) | Employee Model — staff attribution & till | **P1 (schema + `@repo/data` till) committed `dfc0512`; P2 (roster CRUD `account/staff/` + current-worker chip + attribution + walk-in cash €) DONE, uncommitted.** partner 1455 unit + 33 manage integration green. **Next: Phase 3** — per-worker till panel + `closeTill` (`TillClose` snapshot) on the manage page; then accounting breakdown (P4). `migrate:test` owed before any `main` push. Alonso "Group A". | — | 2026-06-19 |

## Proposed / backlog

| ID | Track | Why deferred | Updated |
|----|-------|--------------|---------|
| [003](003-stripe-connect-compliance.md) | Stripe Connect compliance | **Green-field — consumer Stripe code removed (2026-05-23).** Stripe is subs-only; consumer = Mollie + Demo. Build on Connect from scratch if/when consumer Stripe is reintroduced. | 2026-05-23 |
| [009](009-anonymous-equipment-rentals.md) | Anonymous Equipment Rentals | **Planned 2026-06-19** — mirror the anon-sunbed `anonId` flow onto rentals (book/pay/re-find without login). Gap mapped: `RentalBooking` lacks `anonId`/`guestEmail` (schema), `saveRentalBooking` auth-only, rental Mollie ownership check ignores anonId (latent bug), no `findAnonRental`, no rental confirmation email. **P0 = expand migration.** Awaiting 4 open decisions + go-ahead. | 2026-06-19 |

## Done / archived

| ID | Track | Outcome | Updated |
|----|-------|---------|---------|
| [007](007-operator-analytics.md) | Operator Analytics & Exports | **Done.** Alonso "Group B" shipped on the per-site accounting page: `@repo/data/analytics` (5 helpers) + 3 gated actions; rolling revenue lens (B2) + comp/occupancy (B1) + CSV export (B3). data 192 + 2 integration, partner 1427 green; pushed, preview `next build` Ready. ES/FI copy reviewed. | 2026-06-19 |
| [005](005-alonso-beach-model.md) | Alonso Beach App Model | **Done — all 7 phases.** Full functional model of the Alonso Beach competitor app in `.claude/alonso/` (6 subsystem docs + `synthesis-sunbnb.md` payload). Reference for Sunbnb manage-page/accounting design; floor-ops layer flagged as Sunbnb's biggest gap. Wiki promotion deferred (promote on use). | 2026-06-17 |
