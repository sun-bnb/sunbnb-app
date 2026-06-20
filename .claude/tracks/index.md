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
| [010](010-floor-reservation-lookup.md) | Floor Reservation Lookup & Arrivals — "Guests" host stand | **P1+P2 SHIPPED & LIVE on test+prod** (`e7952fd`). `findReservations` + the Guests bottom sheet (arrivals + name/phone/email search beyond today's grid, 🔍 anchor FAB, Locate→`BedDetail`, inline Check-in/Rent). **Floor-lookup gap vs Alonso closed end-to-end.** P3 **correctness slice** (error/empty/loading/a11y) shipped (`80bacc5`). **Next action: VALIDATE, don't build — the surpass layer (P3 roster-CRM, P4 scan-the-pass, P5 resell) is parked as unvalidated demand (Alonso-model hypotheses, not operator asks). Instrument the hypotheses (pass-QR usage, unfulfilled-hold rate) or wait for an operator signal before building.** | — | 2026-06-20 |

## Proposed / backlog

| ID | Track | Why deferred | Updated |
|----|-------|--------------|---------|
| [011](011-group-multiselect-reservation.md) | Group multiselect Reserve/Rent into one reservation | **Scoped, ready to build (awaiting go-ahead).** Partner manage multiselect Reserve/Rent currently makes one reservation PER SEAT — N bookings for one party on N loungers. Fix: a grouped create over the existing `reserveWithConflictGuard({ itemIds })` primitive (already used by the consumer flow + pair-expansion) so a multiselect = one reservation. **Decisions locked: always group (no toggle) + all-or-nothing (one taken seat fails the group).** Small, partner-only, **no schema/migration** (Reservation↔items already many-to-many; downstream already handles multi-item reservations). **Next: P1 — grouped action(s) + gated-actions/auth-matrix registration.** | 2026-06-20 |
| [012](012-multiday-per-day-operational-state.md) | Per-day operational state for multiday sunbed reservations | **Scoped + designed (awaiting decisions before P0).** Multiday bookings carry ONE operational state for the whole stay → stale day-1 arrival time, no daily expected→arrived reset, and a **day-2 double-sell** (departing day-1 frees the bed via `bed-state` `departed` filter). Fix: per-day `ReservationDay` rows (status/checkedInAt/departedAt per civil date); manage/frontdesk read today's row. **Schema change** (additive `ReservationDay` + `Site.timeZone` — no tz field exists today; `Restaurant.timeZone` is precedent). Bug is **duplicated in `frontdesk/`** (P3). Availability stays whole-stay (P2 invariant). **Next: confirm Open decisions Q1–Q5, then P0 expand migration.** | 2026-06-20 |
| [003](003-stripe-connect-compliance.md) | Stripe Connect compliance | **Green-field — consumer Stripe code removed (2026-05-23).** Stripe is subs-only; consumer = Mollie + Demo. Build on Connect from scratch if/when consumer Stripe is reintroduced. | 2026-05-23 |

## Done / archived

| ID | Track | Outcome | Updated |
|----|-------|---------|---------|
| [008](008-employee-model.md) | Employee Model — staff attribution & till | **Done & LIVE on test+prod** (`dfc0512`…`2005640`, deployed 2026-06-20). All 4 phases: Employee roster + per-worker auto-attribution + per-worker till/close (`TillClose`) + manager monthly per-employee cash card (`getStaffTill`). **Full Alonso "Group A" closed.** Additive migration `20260619080811_add_employee_attribution` applied to TEST+PROD. partner unit green, docs/wiki synced. | 2026-06-20 |
| [009](009-anonymous-equipment-rentals.md) | Anonymous Equipment Rentals | **Done & LIVE on test+prod** (`29df253`…`97ae532`, deployed 2026-06-20). All 6 phases (0–5): faithful anon-mirror onto equipment rentals — book / pay / re-find / cancel without login + confirmation/reminder/cancellation emails. Additive migrations `…_rental_booking_anon_fields` + `…_rental_booking_reminder_sent_at` applied to TEST+PROD. user 323 unit + 45 integration, data 214 + 113 green. | 2026-06-20 |
| [007](007-operator-analytics.md) | Operator Analytics & Exports | **Done.** Alonso "Group B" shipped on the per-site accounting page: `@repo/data/analytics` (5 helpers) + 3 gated actions; rolling revenue lens (B2) + comp/occupancy (B1) + CSV export (B3). data 192 + 2 integration, partner 1427 green; pushed, preview `next build` Ready. ES/FI copy reviewed. | 2026-06-19 |
| [005](005-alonso-beach-model.md) | Alonso Beach App Model | **Done — all 7 phases.** Full functional model of the Alonso Beach competitor app in `.claude/alonso/` (6 subsystem docs + `synthesis-sunbnb.md` payload). Reference for Sunbnb manage-page/accounting design; floor-ops layer flagged as Sunbnb's biggest gap. Wiki promotion deferred (promote on use). | 2026-06-17 |
