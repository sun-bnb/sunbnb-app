# Wiki Log

Append-only chronological record of wiki changes and ingests. Newest entries at the bottom.

Entry format (consistent prefix is intentional — it's machine-parseable):

```
## [YYYY-MM-DD] <op> | <summary>
- changed: <file>, <file>
- reason: <one sentence>
- by: <human handle or "auto">
```

Operations:
- `bootstrap` — wiki structure created or restructured
- `ingest` — new code/info absorbed into the wiki
- `lint` — health check pass; usually followed by `revise` entries
- `revise` — corrected or expanded an existing page
- `retire` — marked page stale or removed it

---

## [2026-05-20] bootstrap | LLM wiki established
- changed: `.claude/wiki/README.md`, `.claude/wiki/index.md`, `.claude/wiki/log.md`, `.claude/wiki/workflows/*.md`, `.claude/wiki/entities/*.md`, `.claude/wiki/flows/*.md`, `.claude/wiki/subsystems/*.md`, `CLAUDE.md` (added wiki pointer)
- reason: establish a navigable, LLM-curated knowledge layer over the existing `CLAUDE.md` + `PROJECT_CONTEXT.md` + `.claude/rules/` documentation, modelled on Karpathy's three-layer wiki pattern. Seeded with schema, index, log, 6 workflows, 5 entity pages (reservation, order, invoice, service-fee, settlement), 5 flow pages (reservation-payment, order-payment, rental-booking, walk-in, settlement-cycle), 2 subsystem pages (auth, payments).
- by: claude (opus-4-7)

## [2026-05-20] bootstrap | maintenance discipline added
- mode: revise + add
- changed: `.claude/wiki/README.md` (added page sizing budgets, bounded-section caps, update modes table, refined maintenance discipline with single wiki-worthiness test); `.claude/wiki/workflows/ingest.md` (full rewrite — decision-led structure with worthiness gate, YES/NO criteria, update-mode selection); `.claude/wiki/workflows/lint.md` (added severity tiers, health metrics, hand-off section); `.claude/wiki/workflows/prune.md` (new — active removal of dead content); `.claude/wiki/workflows/review.md` (new — periodic strategic re-pass); `.claude/wiki/index.md` (added prune + review to workflows catalog; grouped maintenance loop vs per-task use); `.claude/commands/wiki.md` (new — thin slash command dispatcher: ingest / lint / prune / review with auto-suggest when no subcommand)
- reason: address the gap Karpathy's pattern leaves open — explicit gates for what's wiki-worthy, bounded sections to prevent bloat, paired lint/prune so removal is intentional, and a periodic review to question whether the wiki's shape still matches the project's shape. Single test for any write: "Will future Claude write better code or answer questions faster because of this update?"
- by: claude (opus-4-7)

## [2026-05-20] add | /context check + /context sync (multi-layer probe & tracker)
- mode: add + revise
- changed: `.claude/scripts/detect-drift.mjs` (NEW location, extended to multi-layer: wiki + canonical via `--scope` flag); `.claude/wiki/scripts/detect-drift.mjs` (DELETED — moved); `.claude/context/workflows/check.md` (NEW — stateless probe procedure); `.claude/context/workflows/sync.md` (NEW — stateful tracker procedure); `.claude/context/state.json` (NEW — cursor file, gitignored); `.claude/commands/context.md` (NEW — slash dispatcher: check / sync / status); `.gitignore` (added `.claude/context/state.json`); `.claude/hooks/pre-push.sample` (updated to new script path); `.claude/wiki/scripts/install-hook.sh` (updated to new script path); `.claude/wiki/workflows/lint.md` (noted `--quick` is now alias for `/context check --scope wiki`); `.claude/commands/wiki.md` (same); `packages/data/CLAUDE.md` (fixed `prisma/schema.prisma` → `packages/data/prisma/schema.prisma` — drift caught by first canonical-layer scan).
- reason: address the asymmetry where the wiki had both stateless drift detection (`/wiki lint --quick`) and recent-changes ingest (`/wiki ingest`), but the canonical layer had only the latter (`/update-knowledge`, naive `git log main..HEAD`). The two new commands fill the gap: `/context check` is stateless multi-layer probe, `/context sync` is the stateful tracker with a per-developer cursor in `.claude/context/state.json`. Both dispatch to existing `/wiki ingest` and `/update-knowledge` for actual writes — no per-layer logic reinvented.
- by: claude (opus-4-7)

## [2026-05-20] revise | unified maintenance gate around five qualities
- mode: revise
- changed: `.claude/wiki/README.md` (primary-objective sentence in header; replaced "The single test" with "The gate" + five-qualities table); `.claude/wiki/workflows/ingest.md` (gate reframed using five qualities; YES criteria tagged with which qualities they gain; new criterion 6 "Ambiguity resolved" for deterministic); `.claude/wiki/workflows/prune.md` (added "How this workflow serves the gate" — concise + deterministic gains framing); `.claude/wiki/workflows/review.md` (Quality signal questions now mapped to each of the five qualities); `.claude/wiki/workflows/lint.md` (severity tiers tagged with qualities at risk); `.claude/commands/wiki.md` (added objective statement at top); `.claude/commands/update-knowledge.md` (worthiness gate reframed using five qualities, with note that layer-2 bloat compounds across sessions).
- reason: replace the previous single-question gates (phrased differently in three files) with one canonical five-qualities formulation. Updates must gain at least one of (informed, effective, reliable) and sacrifice none of (concise, deterministic). The qualities are concrete enough to test against an update; the constraint side prevents bloat that the gain side alone would allow.
- by: claude (opus-4-7)

## [2026-05-20] bootstrap | drift detection automation
- mode: add + patch
- changed: `.claude/wiki/scripts/detect-drift.mjs` (new — Node script, no deps, scans wiki for broken `sources:`/inline-ref/cross-ref); `.claude/hooks/pre-push.sample` (new — warn-only hook); `.claude/wiki/scripts/install-hook.sh` (new — installs hook with backup); `.claude/wiki/workflows/lint.md` (added two-modes section: quick vs full); `.claude/commands/wiki.md` (recognize `lint --quick` flag); `.claude/commands/update-knowledge.md` (layer-separation note + Step 6 wiki ingest hint); `.claude/commands/review.md` (Step 6 wiki ingest hint); plus drift patches surfaced by first script run: `entities/reservation.md` (`services/` → `service/`), `subsystems/auth.md` (`auth.ts` → `app/auth.ts` for all 3 apps), `flows/reservation-payment.md` (`payment/page.tsx` → `payment/Payment.tsx`, `sendConfirmation` → `sendConfirmationEmail`).
- reason: pair the existing user-driven workflows with a cheap mechanical detector so drift caught between sessions costs ~0 tokens. The script formalizes the grep recipes from `workflows/lint.md` "Tooling shortcuts". Soft couplings on `/update-knowledge` and `/review` add proactive nudges at the moments the user is already touching the doc layer.
- by: claude (opus-4-7)

## [2026-05-20] add | subsystem:schematic-editor page
- mode: add
- changed: `.claude/wiki/subsystems/schematic-editor.md` (new — draft); `.claude/wiki/index.md` (registered under Subsystems)
- reason: the shared grid-geometry + editor-chrome layer (`@repo/schematic`, `@repo/schematic-editor`) is the single shared capability behind the sunbed inventory editor, the user sunbed-selection UI, and the restaurant tables editor — but had no synthesis page. Created as the cited shared-knowledge source for the new `sunbed-inventory` specialist agent and the `/schematic` skill. Status draft: core grid math + chair-util verified against code, editor-chrome internals not yet fully read.
- by: claude (opus-4-7)

## [2026-05-21] ingest | Multi-day staff walk-ins + corrected manage action contracts
- mode: revise
- changed: `.claude/wiki/flows/walk-in.md`
- reason: `reserveItem` gained an optional `until` param for multi-day walk-in stays (starts today, max 90d) plus an item+pair overlap check that previously did not exist (apps/partner manage page feature). While revising, corrected stale signatures: the page documented `reserveItem(…, from, to, …)` and `blockBed(…, from, to)` date-window params that never existed in code.
- follow-up: other rows in the Available-actions table use a simplified signature shorthand (omit/garble `siteId`/`accessKey`/reservationId — e.g. `unreserveItem`, `checkInReservation`); a `/wiki lint` pass on this page could reconcile the whole table against `manage/actions.ts`.
- by: claude

## [2026-05-22] add page | Design-system subsystem + /ui capability
- mode: add page
- changed: `.claude/wiki/subsystems/design-system.md` (new); `.claude/wiki/index.md`; new `/ui` command (`.claude/commands/ui.md`); `/ui` wired into partner/user/admin-dev start sequences
- reason: Codify the UI design language as a shared capability (skill + wiki page) mirroring `/schematic`, so per-surface dev agents pull and apply it instead of improvising. Canonical conventions stay in `.claude/rules/ui.md`; this page is orientation — where it lives, building blocks, reference impl (restaurant General tab), invariants/pitfalls (incl. the Tailwind content-scan gotcha for shared packages, and that shared components can't use the app-only `accent`/`.btn-*`).
- follow-up: promote `draft`→`stable` after a verification pass; generalize beyond partner once `apps/user`/`apps/admin` adopt it; revisit if a design-system package-owner agent becomes warranted.
- by: claude

## [2026-05-22] patch | Per-app UI layers moved to apps/<app>/UI.md (pulled, not auto-loaded)
- mode: patch
- changed: `.claude/wiki/subsystems/design-system.md` (per-app pointer → `apps/<app>/UI.md`). Companion non-wiki edits: extracted the per-app UI detail out of each `apps/<app>/CLAUDE.md` into a new `apps/<app>/UI.md`, leaving a one-line pointer in CLAUDE.md; `/ui` command + `.claude/rules/ui.md` re-pointed.
- reason: CLAUDE.md is auto-loaded every session, so per-app UI detail there taxed non-UI tasks. The per-app layer now lives in pulled-on-demand `apps/<app>/UI.md`, loaded only via `/ui <surface>` — detailed when needed, absent otherwise.
- by: claude

## [2026-05-22] revise | Fold full UI conventions into design-system page; lean the rule
- mode: revise
- changed: `.claude/wiki/subsystems/design-system.md` absorbed the full conventions (color/type/spacing/shape, component class expansions, page-structure patterns, resolved conventions). Companion: `.claude/rules/ui.md` trimmed to the non-negotiables + pointers; `/ui` command re-pointed (rule auto-loaded; this page = full conventions).
- reason: `.claude/rules/*` is auto-loaded every session; the ~130-line design language taxed non-UI tasks. The always-loaded rule now carries only the non-negotiables; the full conventions are pulled here via `/ui`. This page is now the canonical detailed design language — a deliberate exception to "wiki points, doesn't replace" (the design language is synthesized prescriptive knowledge with no other canonical home).
- by: claude

## [2026-05-22] add page | Table-reservations product documented (4 pages)
- mode: add page (×4) + patch (×1)
- changed: `.claude/wiki/entities/restaurant.md` (new), `.claude/wiki/entities/table-reservation.md` (new), `.claude/wiki/subsystems/table-reservations.md` (new), `.claude/wiki/flows/table-booking.md` (new); `.claude/wiki/index.md` (cataloged the 4); `.claude/wiki/subsystems/schematic-editor.md` (added `related: subsystem:table-reservations`, bumped last_verified).
- reason: The restaurant table-reservation product (data layer + `@repo/table-reservations-core`/`-ui` + partner `/restaurants` + user `/sites/[id]/table`, all shipped on `main`) had **no** wiki coverage — the gap the track flagged. Synthesized current truth from code at HEAD: the Restaurant aggregate + soft Site FK, the dual-status `TableReservation`/`Table` model, the decoupled-engine/Sunbnb-tight-apps boundary, and the consumer booking flow. Verified against schema + core + app sources cited in each page; the known server-TZ bug and the free-bookings-today fact are documented as current behaviour with a pointer to the planned fixes in `.claude/tracks/002-table-reservations.md` (wiki documents current state, not the plan).
- by: claude (opus-4-7)

## [2026-05-22] revise | Re-ingest table-reservations pages for the P1 implementation
- mode: revise (×4)
- changed: `.claude/wiki/entities/restaurant.md`, `.claude/wiki/entities/table-reservation.md`, `.claude/wiki/subsystems/table-reservations.md`, `.claude/wiki/flows/table-booking.md`.
- reason: The P1 booking core landed (commit 567f987, track 002), invalidating the pages' "current truth": the server-TZ bug is **fixed** (`Restaurant.timeZone` + `tz.ts`), bookings are no longer field-less ("free today" → deposit model present, collection pending), and the engine now does shifts/pacing/combinations + section/feature filters. Rewrote (not appended): availability-engine description (TZ + shifts + pacing + combos), the deposit model + lifecycle, modify/reminder/waitlist paths, the public CORS booking API, group-atomic combo transitions, and the `PACING_FULL` failure mode. Removed the stale server-TZ bug callout + "free until 1e" claims. Roadmap sections now point to the *remaining seams* (deposit money collection, SMS, widget UI, Google/Instagram Reserve, deferred consumer/partner UIs).
- by: claude (opus-4-7)

## [2026-05-23] revise | Document the discovery visibility gate (payment capability) in subsystem:payments
- mode: revise
- changed: `.claude/wiki/subsystems/payments.md` (new "Discovery visibility gate" section; note that the partner UI exposes only Mollie / consumer Stripe is unexposed; added `siteService.ts#searchSites` to sources; bumped last_verified).
- reason: Founder asked to verify + document the gate. Verified in `apps/user/service/siteService.ts#searchSites` (the sole consumer site-discovery query): a Site is listed only if all services are off-platform (`type`/`order_payment_type`/`rental_payment_type` all `IS DISTINCT FROM 'paid'`) **OR** the partner completed Mollie onboarding (`mollieAccessToken` + `mollieOnboardingStatus = 'completed'`) — so venues that can't take payment are hidden as unusable. Clause references only Mollie (reinforces consumer Stripe is not on the payable path → track 003). Current truth, code-cited.
- by: claude (opus-4-7)

## [2026-05-23] revise | Consumer Stripe removed — reconcile payment pages to Mollie + Demo
- mode: revise (×8)
- changed: `.claude/wiki/subsystems/payments.md` (intro, provider matrix, per-site provider, abstraction snippet, demo/entity-id helper paths → `payment-ids.ts`, "Stripe specifics" → "Stripe (subscriptions only)", webhooks table, refunds, config env vars, invariant #4, pitfalls; dropped deleted source files); `.claude/wiki/flows/reservation-payment.md` (Mollie is now the primary sequence, Demo the variant, Stripe sequence + webhook removed, failure modes + sources reworked); `.claude/wiki/flows/order-payment.md` (Mollie create-payment, dropped stripe source/steps); `.claude/wiki/index.md`, `.claude/wiki/entities/reservation.md` (paymentRef: Mollie/demo, legacy `pi_*` noted), `.claude/wiki/flows/rental-booking.md`, `.claude/wiki/workflows/{debugging,feature-design,implementation,query}.md`, `.claude/wiki/README.md` (incidental "Stripe/Mollie/Demo" → "Mollie/Demo"); `.claude/wiki/{entities/table-reservation,flows/table-booking,subsystems/table-reservations}.md` (deposit collection seam reworded: Mollie now, Stripe pre-auth via Connect deferred to track 003).
- reason: Consumer Stripe (reservation/order PaymentIntents, Elements, `_lib/stripe.ts`, the stripe routes + webhook) was purged from `apps/user` (Phase A/B) because it was a platform-collecting charge that violated the marketplace/commission legal model; the prod "stripe" sites were all our own test beaches and were migrated to Mollie first. Consumer payment is now Mollie + Demo only; Stripe survives solely for partner subscriptions (separate subsystem, platform-as-merchant — correct). The wiki described deleted code, so these pages were stale "current truth". Demo retains the legacy `payment_intent` redirect contract — documented as such, not as Stripe.
- by: claude (opus-4-7)

## [2026-05-26] ingest | Invoice model switched net→gross (agent/marketplace)
- mode: revise (×6)
- changed: `.claude/wiki/entities/invoice.md` (two-invoice rule, invariant #6, pitfall, last_verified); `.claude/wiki/entities/service-fee.md` ("Where it's applied" table → uniform B2B-commission prose, pitfall, last_verified); `.claude/wiki/entities/order.md` (invariant #7 + pitfall: fee no longer "added to customer total", last_verified); `.claude/wiki/flows/order-payment.md` (intro, steps 2/3/6, "Key differences" table dropped the fee row, related, pitfall, last_verified — removed the stale pre-Mollie "amount = totalPrice + serviceFee, fee ADDED" model); `.claude/wiki/flows/reservation-payment.md` (step 7 fee-line wording, order-payment cross-ref, last_verified); `.claude/wiki/flows/rental-booking.md` (invoice step, last_verified).
- reason: `packages/data/src/payment.ts` (all four `processConfirmed*`) switched to the agent/marketplace model — PARTNER invoice booked GROSS (full consumer price; partner = merchant of record), PLATFORM invoice is a separate B2B commission billed to the partner (new Invoice fields `recipientCompany*`, `reverseCharge` for cross-border EU B2B; `processingFee` reserved for Mollie-fee reconciliation). PARTNER + PLATFORM no longer sum to the consumer payment. Verified against the live Mollie routes that orders charge `order.paymentAmount` and carve the commission via `applicationFee` (identical to reservations) — so the old "reservations deduct / orders add" distinction is gone, and `order-payment.md`'s "fee added on top" sequence was doubly stale. Change is local-only, not yet pushed. Canon (root `CLAUDE.md`, `packages/data/CLAUDE.md`, `.claude/rules/payments.md`) updated in the same pass via `/update-knowledge`.
- by: claude (opus-4-7)

## [2026-06-18] ingest | Refresh walk-in/on-site flow with full occupancy lifecycle
- mode: revise
- changed: `.claude/wiki/flows/walk-in.md` (added the core "every occupancy is one Reservation row + three axes" model; recast the action table as creators vs transitions vs deleters covering the now-present `holdBed`/`compBed`/`uncompBed`/`releaseHold`/`convertHoldToWalkIn`/`moveReservationToSeats`/`refundReservation`/`cancelReservation`/`removeFailedReservation`/pool-seat actions; added the "two independent clocks" lifespan section — operational flip frees the bed vs cleanup-cron deletes the row, with the 15min/24h/paid-in-cash+held GC cutoffs; added the `until` period-selection section and pool-seat section; refreshed state machines, failure modes, pitfalls, `sources:` (+cleanup route), `last_verified`); `.claude/wiki/index.md` (walk-in one-line summary).
- reason: page was last_verified 2026-05-21 and predated the `held` status (RESERVATION_HELD), `OP_COMP`, the refund/cancel split, `moveReservationToSeats`, pool seats, and had no lifecycle/GC/period model at all — a user asked how long each manage state lasts and how the reservation period fits, which the page couldn't answer. Verified against `apps/partner/app/sites/[id]/manage/actions.ts`, `apps/partner/app/api/reservations-cleanup/route.ts`, `packages/data/src/reservation-status.ts`. Docs-only; nothing deployed.
- by: claude (opus-4-8)

## [2026-06-18] ingest | Fold QR walk-in payment collection into flows/walk-in.md
- mode: revise
- changed: `.claude/wiki/flows/walk-in.md` (new "Collecting a walk-in payment (QR → Mollie)" section; `collectReservationPayment`/`getCollectStatus`/`cancelCollection` row in the transitions table; walk-in→collect→complete/revert in the state machine; cron bullet now notes the `walked-in`/`checked-in` exclusion from the PENDING/PROCESSING GC; +pitfall on collection-revert + mid-collection GC; sources +`reservation-payment.ts` +`webhooks/mollie/route.ts`); `.claude/wiki/index.md` (walk-in summary).
- reason: new feature — partner manage page can now take an online (Mollie) payment for a cash walk-in via QR (commits 8d3786a..6fd7cb0, 0fe5b8e). Shared `createReservationMolliePayment`/`reverifyAndFinalizeReservation` extracted to `@repo/data/reservation-payment` (reused by the consumer route); a failed/abandoned collection reverts to `paid-in-cash` (cancelCollection / poll / webhook `collect` metadata); the cleanup cron excludes occupied walk-ins so a mid-collection `processing` row (old createdAt) isn't GC'd; the beachgoer gets an anonId capability and flows through the standard `/payment/complete` → `/reservations/[id]` receipt path. Verified against the cited sources. Local commits, not yet pushed.
- by: claude (opus-4-8)

## [2026-06-19] ingest | New subsystem page: floor-staff attribution & per-worker till
- mode: create
- changed: `.claude/wiki/subsystems/employee-till.md` (new, **draft**); `.claude/wiki/index.md` (subsystems list entry).
- reason: track 008 (Alonso "Group A") shipped a substantial cross-surface subsystem with no wiki home — a per-`PartnerAccount` `Employee` roster (`/account/staff`), automatic current-worker attribution stamped on every on-site create action (validated by `resolveEmployeeId`, dropped if cross-account), a per-worker cash till + "close my till" `TillClose` snapshot on the manage page (`TillSheet`, `getTillStatus`/`closeTill`), and a manager monthly per-employee cash card on accounting (`getStaffTill` → `getTillByEmployee`). Aggregation in `@repo/data/till`; documents the unit-test mock-aliasing requirement (`@repo/data/till` uses real prisma → must be aliased to `__mocks__` + registered in mock-contract). Spans manage + accounting + account/staff + packages/data, so it earns a subsystem page rather than folding into `flow:walk-in` (which it cross-links). Verified against the cited sources (commits dfc0512, 323e1e8, b094538, 22fa619). Docs-only; nothing deployed. Marked draft pending an independent verification pass.
- by: claude (opus-4-8)

## [2026-07-23] ingest | Day-anchored till rework (track 016) folded into employee-till
- mode: revise
- changed: `.claude/wiki/subsystems/employee-till.md` (Per-worker till section rewritten to the day-anchored two-bucket model; new Admin daily summary & day close section; TillClose carry-over columns in data model; sources + last_verified updated).
- reason: track 016 changed both the contract and the invariants the page documented — `getOpenTill` et al. now take a required venue-local `dayStart` and return `today`/`carryOver` buckets; `closeEmployeeTill` is the single TillClose snapshot writer (records `carryOverAmount`/`carryOverCount`, migration `20260723140622_add_till_close_carry_over`); the daily summary leads with close-independent daily accumulation (`getTillDayReport`) reconciled via "still uncounted / handed in today". Driven by pilot-operator confusion (Alonso-trained, expects strictly per-day tills). Browser-verified end-to-end (midday close leaves the day total constant; carry-over surfaces amber and sweeps with the next close).
- by: claude (fable-5)

## [2026-07-25] ingest | Dine-in tabs v2 (Site decoupling) folded into restaurant + table-reservations
- mode: revise
- changed: `.claude/wiki/entities/restaurant.md` (dineInEnabled gate, tabs/orders relations, MenuItem-now-orderable + VAT triple, standalone fee context; last_verified bumped), `.claude/wiki/subsystems/table-reservations.md` (new dine-in v2 paragraph in app-layer wiring: /tables/[tableId] canonical route + legacy redirect, MenuItem rail, loadTabFeeContext, restaurant kitchen dashboard + accounting, dual-write, deferred standalone gaps).
- reason: dine-in tabs v2 shipped (track 002, commits e528758..bee7e45) — v1's "rides the site Order/Product rails" fork is superseded; standalone (siteId-null) restaurants now order end-to-end. Both pages documented the v1 coupling as current. Browser-verified standalone loop with DB invoice proof before ingesting.
- by: claude (fable-5)

## [2026-08-09] ingest | Proactive Mollie missing-scope detection + 8h partner session
- mode: patch
- changed: `.claude/wiki/subsystems/payments.md` (new "Granted scopes can be narrower than requested" section under Mollie specifics; +1 pitfall → 7; corrected `getValidMollieToken(partnerAccountId)` signature and the renamed `findPartnerAccountForPayment`; sources + related + last_verified), `.claude/wiki/subsystems/auth.md` (partner provider list corrected — it was documented as "Google OAuth only" but also carries Facebook, Credentials and an impersonation provider; session `maxAge` 8h + the idle-vs-absolute mechanism; +1 pitfall → 6; sources + related + last_verified), `.claude/wiki/flows/walk-in.md` (refund-403 failure-mode row now records that staff usually cannot complete the re-consent), `.claude/wiki/index.md` (auth summary line).
- reason: commit 05231d2 made a narrow Mollie OAuth grant detectable before it fails. Two gate criteria: a changed invariant (partner session lifetime 30d → 8h, and it is load-bearing — the scope check runs in the `jwt` callback at sign-in only, so session length paces detection) and a hard-earned gotcha (`@auth/core` re-signs the JWT with a fresh expiry on every session read under the `jwt` strategy, so `maxAge` is an IDLE timeout and `updateAge` applies only to the database strategy — this was assumed to be absolute during design and the assumption drove the wrong first plan). Detection uses `GET /v2/permissions`, which reports `granted` per scope and needs no scope of its own; Mollie has no introspection endpoint. No new page — the two-strikes rule applies and both facts had natural homes. The three corrected claims above were found while re-verifying the touched sections, not introduced by this commit. Not browser-verified: exercising the banner needs a Mollie account with a genuinely narrow grant.
- by: claude (opus-5)

## [2026-08-11] ingest | Reservation state machine (track 018 P0–P4)
- mode: new-page
- changed: `.claude/wiki/subsystems/reservation-state-machine.md` (new, stable — browser-verified 2026-08-11), `.claude/wiki/index.md` (+1 subsystem line), `packages/data/CLAUDE.md` (machine section + issueCashCreditNote + test lists), `apps/partner/CLAUDE.md` (delegation notes, undoDepartWalkIn, matrix/bed-state/frontdesk test rows, counts 1968u/198i, auth-matrix 669, mock-contract 17), `apps/user/CLAUDE.md` (machine delegation notes, webhook 34, counts 478u/77i, machine mock).
- reason: track 018 shipped a load-bearing new subsystem across 10 commits (608bc55…ba6a826): the founder-signed transition table + interpreter is now the ONLY reservation state writer (allowlist 36 sites/9 files → 9 sites/2 files), with two additive migrations (split_from_id, credits_invoice_id), credit notes, and the B1 double-charge family fixed by construction. Gate: future agents must edit the TABLE (not action guards) and will find the machine via CLAUDE.md/wiki instead of re-deriving the compound-state model — the defacto/intended docs in `.claude/tracks/` carry the full design record.
- by: claude (fable-5)
