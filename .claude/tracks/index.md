# Track Registry

The control plane — every track, its state, and where to resume. **Start here.**
Maintained by the `create` and `handoff` workflows.

## Active

| ID | Track | Next action | Worktree | Updated |
|----|-------|-------------|----------|---------|
| [001](001-knowledge-store.md) | Knowledge Store | Phase 1 — stand up Vercel test-env log-drain adapter | — | 2026-05-20 |
| [002](002-table-reservations.md) | Table Reservations | P1 complete (1a–1h) + pick-your-spot (`71c75e7`, committed local). **Next: `migrate:test` then push** (additive migration pending Neon TEST DB); then browser-verify, P2 live floor | — | 2026-05-27 |
| [004](004-partner-test-architecture.md) | Partner Test Architecture | **PARTNER SCOPE COMPLETE** (Phases 0/3/1/4 — spine, fixes, backfill, cleanup+coverage-ratchet; 901 unit + 89 integration green, full gate green). Phase 1+4 local (`d4621b0`→`8386e7b`, 6 unpushed). Deferred: @repo/test-utils extraction, createWalkInRental race. | — | 2026-06-17 |
| [005](005-alonso-beach-model.md) | Alonso Beach App Model | P0–P2 done (scaffold + sunbed 5-state machine + reservations/rentals). **Next: P3** — model *Cierre de Caja* / accounting + day-reset → `.claude/alonso/model/accounting-and-dayclose.md` (extract from saved prod bundle). Research/modelling only, no build. | — | 2026-06-17 |

## Proposed / backlog

| ID | Track | Why deferred | Updated |
|----|-------|--------------|---------|
| [003](003-stripe-connect-compliance.md) | Stripe Connect compliance | **Green-field — consumer Stripe code removed (2026-05-23).** Stripe is subs-only; consumer = Mollie + Demo. Build on Connect from scratch if/when consumer Stripe is reintroduced. | 2026-05-23 |

## Done / archived

_(none yet)_
