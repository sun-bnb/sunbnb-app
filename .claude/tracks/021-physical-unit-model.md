---
id: 021-physical-unit-model
title: Physical unit model — durable mount point, policy split from structure
status: active
created: 2026-08-16
updated: 2026-08-16
worktree: null
---

## Goal

Make **the physical unit** — the spot where a shade (parasol, canopy, or nothing) and its
beds stand — a first-class, durable entity, so that hardware can be bound to something that
survives inventory editing, and so that *how beds are sold* stops being encoded in *how beds
are physically arranged*.

Today neither is true, and [[track:019]]'s device work is about to be built on top of it:

- **There is no stable identifier for a physical unit.** The seat id is deletable through
  six paths; the `SunbedGroup` id is dissolved and re-minted whenever pairing composition
  changes; and the unit number inside a seat label (`2-302-1` → parcel 2, row 3, unit 02,
  member 1) is a **positional ordinal recomputed site-wide** after nearly every mutation —
  insert or remove a unit mid-row and every unit to its right is renamed.
- **Structure is being used to express policy.** Beds are grouped so they must be booked
  together — the expansion helpers treat *membership* as "book these as one". So beds get
  grouped for commercial reasons rather than physical ones, after which the structure no
  longer describes the physical world, which is exactly what a device mount needs it to do.
  (The original `pairId` mechanism is already vestigial — `SunbedGroup` superseded it, and
  the policy conflation moved with it. P1 finishes that removal.)

End state: a device is bound to a unit; beds under it can be added, removed, renumbered,
re-paired and stored for the winter without the fleet noticing; an operator can change
whether beds sell singly or together without touching structure; and deleting a unit that
has hardware on it is refused rather than silently cascaded.

**Why now:** it is nearly free to change what a binding points at while a handful of test
bindings exist, and it costs a re-bind of every installed device afterwards. The codes and
stickers are unaffected either way, so this is a modelling decision, not a logistics one —
but it wants making **before mass binding**, not after.

## Resume here

- **Next action: P0 — the classification audit.** Nothing is decided empirically yet. Two
  things must be known before schema is written:
  1. ✅ **ANSWERED 2026-08-16 — the `pairId` gate is GREEN on all three environments.**
     `pair_id IS NOT NULL AND sunbed_group_id IS NULL` = **0** in dev, test AND production.
     P1 may proceed to the drop once the code stops reading/writing the column.
  2. ✅ **ANSWERED 2026-08-16 — there are NO n-ary physical units anywhere.** The dev
     "3- and 5-member groups" are pairs with **pool spares parked on them** (`status='pool'`,
     sentinel coords, `199xx` numbers — the manage page's "group extra" concept). Every real
     unit in dev, test and production is a PAIR. Consequence for P5: a unit's membership is
     **not** the same as "the beds under the shade" — the device must bind to the group's
     **placed (non-pool)** members, or a pair with a spare parked on it would try to light a
     third segment. Superseded question text: production and
     test hold **only 2-member groups** (551 and 216). The two 3-member groups and the one
     5-member group exist **in the dev DB alone** — so before treating them as a real domain
     case, establish whether they are genuine venue geometry or artifacts of experimentation
     / the [[track:020]] scale fixture. If they are artifacts, Q4 is moot for migration
     purposes (the model must still support n-ary, since the editor allows it) and P3's
     backfill has no ambiguity to resolve.
  3. **Do seat labels correspond to anything physical** — painted numbers, signage, what
     staff say to a guest? If yes, today's automatic renumbering is already a live bug and
     P1 rises in priority independently of hardware.
- **Context needed:** this file · `packages/data/src/seat-label.ts` (the positional unit
  ordinal) · `apps/partner/app/sites/[id]/inventory/actions.ts` `assignChairPairings` (the
  dissolve/re-mint, rewritten under [[track:020]]) · `packages/data/prisma/schema.prisma`
  (`SunbedGroup`, `InventoryItem.pairId`, `Device`/`DeviceSeat`) · [[track:019]] (the
  consumer; its Q1 is superseded here) · `.claude/rules/migrations.md` (expand/contract).
- **Blocked by:** nothing. Q1/Q2 (device cardinality, LED segment order) block P5 only;
  P0's findings block P3.
- **Do NOT** start with the schema. P0 is an audit precisely because the backfill shape
  depends on what the existing multi-member groups mean.

## Operating constraint (founder, 2026-08-16)

**The system stays usable throughout.** No migration in this track may reset or rebuild the
database, and no phase may break live operations. Concretely, for every phase:

- **Additive first, destructive later** — expand/contract per `.claude/rules/migrations.md`;
  the only destructive step planned is P1's column drop, and it lands a release AFTER the
  code stops using it.
- **Backfills are idempotent and re-runnable**, and are verified against a copy of real data
  volumes before they touch test or production.
- **Both directions must hold** while a release is in flight: new code tolerates old data,
  old code (test.sunbnb.app runs behind `main` on the SHARED test DB) tolerates new data.
- **Behaviour-preserving phases must be PROVEN so**, not assumed — oracle tests that run the
  pre-change implementation as referee, which is how [[track:020]] validated the availability
  and payload rewrites.
- **Every phase ships green**: full unit + integration gates for each app touched, plus a
  browser check of the surface an operator actually uses before it is called done.

## Invariants

The spine. Every phase either establishes one of these or is guarded by it.

- **I1 — Universal placement.** Every *placed* seat belongs to exactly one unit. A null
  `sunbedGroupId` means precisely "not placed — in the pool", and nothing else. (This keeps
  the manage page's existing free-pool vs group-extra distinction working unchanged.)
- **I2 — Durable identity.** A unit's id survives rotation, spacing, parcel moves, member
  add/remove, re-pairing, and season turnover. Only an explicit delete ends a unit.
- **I3 — Persisted name.** A unit's number is stored, not derived from position. Adding or
  removing a neighbouring unit never renames an existing one.
- **I4 — Policy is a parameter.** Sell granularity resolves site → parcel → unit, mirroring
  the existing `price` and service-fee cascades. Structure never encodes policy.
- **I5 — Hardware anchors to units.** A device binds to a unit, never to seats. Deleting a
  unit with a device bound is **refused**, not cascaded.
- **I6 — Server-side enforcement.** Booking granularity is enforced in availability and in
  the create path, never only in the UI.

## Roadmap

- **▶ P0 — Classification audit + touchpoint map.** No code. (a) Classify every existing
  multi-member group as physical or commercial (dev + production, read-only). (b) Answer the
  label-is-physical question. (c) Produce the definitive list of pairing touchpoints — the
  10 boolean uses of `sunbedGroupId`, the 13 files reading `pairId`, `pickFirstAvailablePair`
  (order-dependent, integration-tested under [[track:020]] P1), and the six seat-deletion
  paths. Deliverable: findings appended to this file + Q4 answered.

- **▶ P1 — Retire the legacy `pairId` — (a)–(c) BUILT 2026-08-16, uncommitted; (d) the
  column drop is a later release.** Done: dual-writes stopped in all three write paths
  (`assignChairPairings` — with track 020's pure-rotation fast path preserved —
  `pairInventoryItems`, and the calendar projection); every fallback read deleted across both
  apps (manage, calendar, both partner editors, user preselection, both user selection
  surfaces, POS); the dead `pairId`/`pairedBy` selects removed; and the calendar modal's
  `pairId` prop dropped (declared, never read). **New ratchet** `app/test/no-pairid-writes.ts`
  in the style of track 018's single-writer guard: nothing may point `pairId` at another seat
  again, exact-equality shrink-only allowlist (`inventory-actions.ts`, which must keep
  clearing references until the column is gone). It caught a write I had missed on its first
  run. **Tests were converted, not deleted** — the four double-booking guards and the four
  preselection tests now express the same behaviour through a shared `createTestPairedUnit`
  fixture, plus three NEW tests pinning the contract that a legacy pairId without a group does
  NOT expand. Green: partner 2004u + 223i, user 539u + 102i, tsc + lint clean on both.
  **(a)–(c) now COMPLETE**: the remaining reads are gone too (the manage self-heal keeps
  healing an ungrouped anchor but no longer pulls a legacy partner; the properties action no
  longer connects the `pair` RELATION — which writes `pair_id` just as surely as the scalar
  and was the ratchet's first real blind spot, now closed), and neither app ships
  `pair`/`pairedBy`/`pairId` in any payload (five user surfaces + the partner item
  projection). **Only the column itself remains, as its own later release (d).**

  Original scope note: **☐ P1 — Retire the legacy `pairId` (contract, two releases).** **Every reader in BOTH
  apps is already group-first** — verified line by line, and the code says so itself
  ("Prefer group-based pairing (SunbedGroup source of truth)", "Falls back to pair/pairedBy
  when no group is set", "SunbedGroup is authoritative"). Combined with P0's numbers (no row
  anywhere has a pairId without a group), **every `pair`/`pairedBy` branch is unreachable**.
  So: (a) delete the fallback branches in both apps, (b) stop shipping `pair`/`pairedBy` in
  the four user page/route includes and the partner item projection (a payload win too),
  (c) stop the dual-write in `assignChairPairings` — **without regressing [[track:020]]'s
  pure-rotation fast path**, (d) NEXT release drop the column. The clear-on-delete sweep in
  `inventory-actions.ts` **stays** until the column is gone: old rows keep their values and
  the self-FK still bites. Old deployed code is unaffected in both directions — it is
  group-first too, and existing values are left in place rather than nulled. The
  now-superseded note: already vestigial on the partner side — the
  expansion helpers in `manage/actions.ts` and `calendar/actions.ts` are commented
  "SunbedGroup is authoritative" and reach `pairId`/`pairedBy` only under "Legacy fallback",
  which never fires (see P0). `assignChairPairings` still dual-writes it. Release N: stop
  writing, delete the fallback branches, and make the remaining `pair`/`pairedBy` readers
  (user-app preselection walking, the partner item projection) group-first. Release N+1:
  **drop the column** — destructive, so it lands at promote time per
  `.claude/rules/migrations.md`. Doing this FIRST means every later phase works against one
  representation instead of maintaining a dual-write.

- **✅ P2 — Universal units (I1) — DONE 2026-08-16. Founder decisions 2026-08-16:** seats are **never
  ungrouped** — a parcel is created as groups-of-groups, and "add a seat" creates a **unit of
  two by default** rather than a lone bed. Manual **pair/unpair is obsolete** and its actions
  (`pairInventoryItems`, `depairInventoryItem`) plus their UI are removed here.
  **Sequencing matters:** removing depair BEFORE creation always produces groups would strand
  any mis-grouped seat with no way to fix it, so unit-creating writes land first, the actions
  go second. Whether a unit may be booked partially becomes a **property** (P6), not a
  structural act.
 *Backfill is far smaller than assumed: **production has
  ZERO placed-but-ungrouped seats** — I1 already holds there — and test has 24. The work is
  the write paths and the guard, not the data.* Backfill a one-member unit for every placed seat; make
  every seat-creating path mint one (`createInventoryItem`, `syncChairsWithLayout` create,
  the manage add-seat flow); enforce I1 with a guard test in the style of the
  reservation-machine single-writer ratchet (a DB `NOT NULL` is wrong here — pool seats
  legitimately hold null). Fix the two real collisions found in the audit:
  `selectedSingleItemHasPair={!!sunbedGroupId}` in both editors becomes a member-count test.
  The singleton branch in `seat-label.ts` becomes dead code — its output must not change.

- **☐ P3 — Persisted unit number (expand, behaviour-preserving).** Add a stored number to
  `SunbedGroup` — **depends on P2**: `groupSeq` is persisted ON a unit row, and until every
  placed seat has one, singletons have nothing to carry their number. backfill it from the *current* positional ordinal so **every existing label
  is byte-identical on the day it ships**; switch `computeSeatLabels` to read the stored
  value. Guard: an oracle test asserting the new label output equals the old function's
  output across the real fixture matrix. Independently valuable — this is the fix for label
  drift under physical signage, with or without hardware.

- **☐ P4 — Identity survives composition change (I2).** Extend "match and preserve" from
  geometry to membership in the rearrange/pairing path. Rotation and moves already preserve
  groups (pinned by the [[track:020]] test asserting byte-identical ids across a 200-seat
  rotation); a parcel re-apply that changes pairing still dissolves and re-mints — which is
  what would destroy the existing 3- and 5-member groups. Units must be matched to their
  successors and keep their id and number.

- **☐ P5 — Device binds to the unit (I5).** `Device` points at a unit; migrate existing
  `DeviceSeat` rows; make the seat/unit FK **Restrict** so deletion is refused rather than
  cascaded; add an append-only binding event log so the physical fact outlives any FK. Note
  `SunbedGroup` already carries `siteId`, so this **also solves device discoverability for
  free** — an orphaned or unbound device is reachable from its site without adding a site
  column to `Device`. Resolves Q1 + Q2. **[[track:019]] P4 (the field binding flow) depends
  on this (P5 here)** and should not be built before it.

- **☐ P6 — Sell policy (I4, I6).** A booking-granularity parameter resolved site → parcel →
  unit. Enforce in availability (a whole-sell unit is available only if every member is
  free) and in the create path; `pickFirstAvailablePair` becomes unit-based. Must agree with
  [[track:018]]'s existing rule that per-seat subset splits are allowed for offline cash
  bookings while online reservations stay whole. Guest-visible and money-adjacent: oracle
  tests against current behaviour, and the backfill sets every existing multi-member unit to
  "whole" so nothing changes on release.

- **☐ P7 — Rename (optional).** Rename the model to what it now means — a unit/pitch/stand —
  via Prisma `@map`, leaving the column alone. Rename last, when the semantics are stable.

## Open decisions

1. **Q1 — Device↔unit cardinality.** Exactly one device per unit? A five-bed canopy might
   carry one device with fewer segments, or two devices; one device might cover two adjacent
   pairs. 1:1 vs many-to-one changes the schema. *Blocks P5.*
2. **Q2 — LED segment mapping.** Derive segment order from the unit's member order, or keep
   an explicit per-segment override? `DeviceSeat.position` exists today precisely to record
   a mount fact rather than infer it — a device mounted rotated, or a row numbered
   right-to-left, breaks derivation. Leaning: keep an override; it is cheap and the failure
   it prevents is a lit-up wrong bed. *Blocks P5.*
3. **Q3 — Label scheme.** Keep the composite `{parcel}-{row}{unit}-{member}` with a
   persisted unit number, or move to a flat per-site unit number ("parasol 42")? Affects
   signage, staff speech, and anything already printed. *Blocks P2's backfill shape.*
4. **Q4 — What do today's multi-member groups mean?** Physical (under one shade) or
   commercial (sold together)? If both, the physical unit is a subset of grouping and P3's
   backfill must split them. *P0 answers this empirically.*
5. **Q5 — Empty units.** A unit whose beds are all removed (winter) should persist — that is
   the point of the model — but it needs a representation in the editor so it is not
   mistaken for a bug, and a rule for when it may be garbage-collected.
7. **Q7 — Copy: does "paired" survive?** The seat toolbar still shows a "· paired" badge,
   now meaning "this seat's unit has more than one member". It is accurate, but the
   vocabulary is moving to units/pitches, and user-facing copy is founder-reviewed
   (`.claude/rules/deploys.md`). Rename, keep, or drop.
6. **Q6 — Site deletion.** With I5's Restrict, deleting a site with bound devices fails.
   That is arguably correct (hardware is installed there) but needs an explicit operator
   path: unbind the fleet first.

## Log

- **2026-08-16 — P2 COMPLETE: units are created, never assembled.** Founder answered the two
  forks: a single add places a **unit of two side by side**, and there is **no split
  affordance** — a mis-grouped unit is deleted and placed again. Implemented:
  `createInventoryItem` now creates a placed 2-seat unit in ONE transaction, taking its
  offsets from the same `generateChairGrid` a parcel uses so a hand-placed unit and a
  generated pair are geometrically identical (it also removed the old create-at-origin →
  move-into-place round trip, which briefly parked every new seat on null island).
  `pairInventoryItems`/`depairInventoryItem` deleted along with their hook helpers, both
  editors' pairing modes, the toolbar controls, and their registry entries — 105 lines of
  action code plus the UI. The "· paired" status BADGE was kept deliberately: it now reads
  "this seat's unit has more than one member", which is still true and useful — **but the
  word belongs to the retired vocabulary, so it is a copy question for the founder** (see
  Q7). Browser-verified on a throwaway site: one click → 2 seats / 1 unit / none on the
  origin, pair+depair controls absent, no page errors; site deleted afterwards. The
  concurrency guard was updated, not weakened — five parallel creates now add ten seats and
  the property under test (distinct, gapless numbers under the advisory lock) is unchanged.
  Gates: partner 1992u + 228i, tsc + lint clean.
- **2026-08-16 — P2 first half shipped: I1 now holds by construction, not by luck.** The real
  gap was narrower than "seats can be ungrouped": pairing only groups seats when `pairSeats`
  is ON, so a parcel created with pairing OFF produced an entire parcel of unitless seats.
  Closed with one shared, set-based `ensurePlacedSeatsHaveUnits` in `@repo/data/unit` — called
  by `syncChairsWithLayout` (scoped to the parcel) and by the backfill, so the app and the
  migration cannot disagree about what "placed" means. `createInventoryItem` now mints the
  unit in the SAME transaction as the seat (a seat committing without one would be an I1
  violation nothing repairs). Collision fixed in both editors: `hasPair` was
  `!!sunbedGroupId`, permanently true once membership is universal — it is a CARDINALITY
  question now (`members > 1`). Backfill `backfill-units.ts` is additive-only, idempotent and
  `--dry-run`-first: it created 24 units locally and the re-run was a clean no-op; production
  needs **zero** (I1 already held there). **User op:** `npm run backfill:units:test` (24
  expected — local mirrors test) before/with the deploy; production is a no-op but worth
  running for the audit line. Gates: partner 2005u + 228i, user 539u + 102i, data 374u + 350i,
  tsc + lint clean, editor browser-verified, and the I1 audit query returns 0.
- **2026-08-16 — P2/P3 SWAPPED: persisted numbering depends on universal units.** Reading
  `computeSeatLabels` end-to-end showed the ordering was backwards. The unit number
  (`groupSeq`) is an ordinal within a `(parcel,row)` bucket, and a singleton seat participates
  in that ordering under a synthetic `__solo_<itemId>` key with **no `SunbedGroup` row at
  all** — so there is nowhere to persist its number until units are universal. Universal units
  therefore comes first (now P2), persisted numbering second (now P3). Also noted for P3: the
  ordinal is scoped to `(parcel,row)`, not site-wide, so a persisted number must preserve that
  scoping or every existing label changes.
- **2026-08-16 — P1 code half COMPLETE; the ratchet had a blind spot of its own.** Finishing
  the reads turned up the write I would most likely have shipped: `saveInventoryItemProperties`
  paired seats through the **Prisma relation** (`pair: { connect: { id } }`), which sets
  `pair_id` without ever containing the literal `pairId:` the ratchet scanned for. Found by
  reading the write path by hand, not by the guard — so the guard now treats a relation
  connect as a write. Also removed: the legacy pair-partner pull from the manage self-heal
  (it still heals an ungrouped anchor into its own group, which is P3's direction), and every
  `pair`/`pairedBy`/`pairId` projection across five user surfaces and the partner item select
  (a payload trim on top). Five more tests re-pinned to the new contract rather than deleted.
  Full gates green both apps — partner 2004u + 223i, user 539u + 102i, tsc + lint clean — and
  the inventory editor browser-verified afterwards (parcel opens to 117 seats, rotate
  round-trip, seat panel, no console errors; parcel 1 left at its original −25°).
- **2026-08-16 — P1 (a)–(c) built; the ratchet paid for itself immediately.** Stopping the
  dual-write and deleting every fallback was behaviour-preserving by construction (P0 proved
  the branches unreachable in all three environments), but three things were worth the care
  the founder asked for: (1) the new `no-pairid-writes` ratchet found a `pairId` write in
  `manage/actions.ts` that my own grep had missed; (2) two blind `replace(...,1)` edits hit
  the WRONG test — silently inverting the group-expansion assertions in the calendar and
  manage suites — which only the test run caught, a reminder that "the string appears twice"
  is the default case in a test file; (3) the integration failures were the valuable ones —
  four of them were double-booking regression guards whose fixtures paired via `pairId` alone,
  a shape that exists in no real database, so they were migrated to a shared
  `createTestPairedUnit` fixture rather than weakened. Net: 2004u+223i partner, 539u+102i
  user, all green, with three added tests pinning the new contract.
- **2026-08-16 — Founder decisions: manual pairing is obsolete; seats are never ungrouped.**
  Parcels are created as groups-of-groups; "add a seat" creates a unit of two by default;
  `pairInventoryItems`/`depairInventoryItem` and their UI are removed in P3; partial-booking
  permission becomes a unit **property** (P6), not a structural act. Recorded with the
  sequencing constraint that unit-creating writes must land BEFORE depair is removed, or a
  mis-grouped seat becomes unfixable.
- **2026-08-16 — Founder constraint recorded** (see *Operating constraint*): the system stays
  usable, no migration resets the DB, nothing breaks live operations, and confidence comes
  from impact analysis + meaningful tests rather than assertion.
- **2026-08-16 — CORRECTION to the entry below: the user app is group-first too.** The claim
  that it "never migrated off pairId" was wrong — `sunbed-preselection.ts`,
  `SunbedSelection.tsx`, `SchematicSelection.tsx` and `pos/[itemId]/queries.ts` all check
  `sunbedGroup` FIRST and reach the self-relation only as a labelled fallback. With P0's
  numbers those branches are unreachable in every environment, which makes P1 a deletion
  rather than a migration — materially lower risk than recorded a few minutes earlier.
- **2026-08-16 — P0 essentially complete; two findings changed the shape of P1 and P5.**
  (1) **Q4 is answered and the answer is "no n-ary units exist".** The dev 3/5-member groups
  decompose as a real pair PLUS pool spares (`19902`–`19906`, `status='pool'`, null-island
  coords) attached to the same group — the "group extra" concept, not a canopy. So the
  migration carries no ambiguity in any environment. **New rule for P5:** the device binds to
  a unit's **placed** members only; group membership includes spares. Also noted: the label
  function buckets by `(parcel,row)` BEFORE grouping, so a group spanning buckets is split —
  which is why those pool members carry their own `1-99xx-n` labels rather than becoming
  member 3 of the pair. P2's byte-identical-output guard will pin that behaviour.
  (2) **The user app never migrated off `pairId`.** Partner reads are dead fallbacks, but the
  consumer app uses the self-relation for real behaviour (preselection, pair rendering on
  both selection surfaces, POS). P1 therefore starts with a user-app migration, not a
  deletion.

- **2026-08-16 — Production + test measured; the P1 gate is green and P3 shrinks.** Read-only
  aggregates (inside `BEGIN TRANSACTION READ ONLY`, counts only — no rows, no PII) via
  `scripts/with-db-url.sh`, since the `/db` MCP servers are not connected in this session.
  **`pair_id` with no group = 0 in production, test and dev** → P1's column drop is
  unblocked. **Production: 1 102 items, 100 % grouped, 551 groups, every one a PAIR, and
  ZERO placed-but-ungrouped seats** — so invariant I1 already holds in production and P3's
  backfill there is a no-op (test: 24 seats). **The 3- and 5-member groups exist only in
  dev**, so the Q4 ambiguity is not present in any real venue; establish whether they are
  experimentation artifacts before treating n-ary grouping as a live domain case (the model
  must still support it — the editor allows arbitrary grouping — but the migration carries no
  ambiguity). Incidental but relevant to [[track:019]]: production is ~551 parasols today,
  which is the real near-term fleet size.

- **2026-08-16 — `pairId` confirmed vestigial; retirement moved to the FRONT of the
  roadmap.** Founder: *"actual pairing has been made legacy by now hasn't it? Pairs are groups
  even now right?"* — verified both ways. Dev DB: **0** items carry a `pairId` without a
  group, while 2 286 carry a group without a `pairId` (the second member of a one-directional
  pair, plus the 3/5-member groups). The code agrees in its own comments: both expansion
  helpers read `SunbedGroup` as "authoritative" and reach `pairId`/`pairedBy` only under
  "Legacy fallback" — branches that cannot fire against this data. `assignChairPairings`
  still dual-writes the column. Consequence for the plan: retiring `pairId` is not a tail-end
  contract step, it is a cheap FIRST step that removes a dual-write every later phase would
  otherwise have to maintain. Roadmap renumbered (old P1–P6 → P2–P7). Also corrected a framing
  error in the Goal: the policy conflation no longer lives in `pairId` but in *group
  membership implying joint booking* — which is what P6 addresses.

- **2026-08-16 — Scoped.** Grew out of a design conversation that started at "how do we
  assign codes/devices to sunbeds" ([[track:019]] P3/P4) and worked down to the foundation.
  The founder's call: *"we can't avoid it with introduction of devices or we will be building
  on a shaky base."*
  Findings that shaped it, each verified against the code rather than assumed:
  (1) **Six** seat-deletion paths exist and **none knows devices exist**; `DeviceSeat.itemId`
  is `onDelete: Cascade` and `hw-filter.ts` declines a device with zero seats, so deleting a
  parcel would silently turn a batch of parasols amber with no record of what they were bound
  to — and [[track:020]]'s new bulk delete makes that one transaction instead of N actions.
  (2) The seat label's unit number is a **positional ordinal**, so a label captured at bind
  time is a coordinate, not a name — killing the "record the label for recovery" idea that was
  proposed earlier in the same conversation.
  (3) `SunbedGroup` is genuinely **1-n** in the schema (the pair assumption lives in the
  `@unique` `pairId` and the grid generator), and the dev DB already holds groups of 3 and 5.
  (4) Group identity is **already stable** under rotation/spacing/move — the [[track:020]]
  rearrange test pins ids byte-identical across a 200-seat rotation — so the durability gap is
  narrower than first assumed: composition changes, not geometry.
  (5) `SunbedGroup` already carries `siteId`, which solves device discoverability without a
  new column on `Device`.
- **2026-08-16 — [[track:019]] Q1 is superseded.** 019 decided the binding must be an
  explicit **seat** list, reasoning that "the binding is a *physical installation* fact and
  `SunbedGroup` is a *booking* fact; deriving one from the other over-scopes wherever
  grouping ≠ shading." That was correct **under the old model**. This track removes its
  premise: once units are universal (I1) and selling policy moves to parameters (I4),
  `SunbedGroup` stops being a booking fact and becomes the physical one — so binding to it is
  no longer over-scoping, it is binding to exactly the right object. Recorded in 019 too.

## Links

- [[track:019]] — HW API; the consumer of this model. Its P4 (field binding flow) depends on
  P4 here; its Q1 is superseded (see Log).
- [[track:020]] — Large-venue scale; source of the bulk delete that widens the blast radius,
  of the rearrange match-and-preserve machinery P3 extends, and of the availability ordering
  tests P5 must not break.
- [[track:018]] — Reservation state machine; owns the existing offline-split vs online-whole
  rule that P5's policy must agree with, and the single-writer guard-test pattern P2 copies.
- [[track:012]] — Per-day operational state; precedent for an additive expand migration on
  the reservation/inventory core.
