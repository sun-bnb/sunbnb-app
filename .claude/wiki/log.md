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
