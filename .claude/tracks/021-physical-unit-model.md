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

- **▶ NEXT ACTION: P4 (A1) — make parcel resize a real edit.** See *Delivery sequence* for
  the full ordering across this track and [[track:019]]. P0–P3 are done and committed; the
  device binding model is settled and recorded (see P5 + the Log). Outstanding USER OPS:
  `npm run migrate:test` before any `main` push (the `seq` migration is local + `sunbnb_test`
  only), then `backfill:units:test` and `:production` to assign ordinals.
- **Superseded next-action (P0, now complete):** Nothing is decided empirically yet. Two
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

## Delivery sequence

The remaining work spans this track and [[track:019]]. Order is chosen so that each phase is
independently shippable, nothing waits on hardware that does not have to, and the riskiest
thing (a fielded wire contract) is decided last — after a real device has exercised it.

| # | Phase | Track | Depends on | Why here |
|---|---|---|---|---|
| 1 | ✅ **P4 — parcel resize + identity** | 021 | — | DONE 2026-08-16 — resize is a real edit; re-pairing reuses units |
| 2 | **P1(d) — drop `pairId`** | 021 | current release deployed | Destructive, so a release AFTER the code stopped reading it (expand/contract) |
| 3 | **Device model + telemetry persistence** | 019 P5 | — | The fleet list has nothing to render until telemetry persists; buildable with no hardware |
| 4 | **Fleet UI** | 019 P5 | 3 | Devices self-register; surfaces unassigned / assigned-not-applied / silent / spots without devices |
| 5 | **Assignment + config delivery** | 021 P5 · 019 P4 | 1, 3, 4 | Assign a location from the UI; state response carries it inside the hashed `stable`; telemetry reports what is applied |
| 6 | **Wire contract freeze + bring-up** | 019 | 5 + hardware | Freeze only once a real device has run the contract; expensive after 1 500 units carry it |
| 7 | **P6 — sell policy** | 021 | 1 | Independent of hardware entirely — can run in parallel with 3–6 |
| 8 | **P7 — rename** | 021 | 7 | Cosmetic; last, when the vocabulary is stable |

Hardware is not on the critical path until 6: phases 3–5 are server work that can land while
the kit is in transit.

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

- **✅ P3 — Persisted unit number — DONE 2026-08-16 (expand, behaviour-preserving).** Add a stored number to
  `SunbedGroup` — **depends on P2**: `groupSeq` is persisted ON a unit row, and until every
  placed seat has one, singletons have nothing to carry their number. backfill it from the *current* positional ordinal so **every existing label
  is byte-identical on the day it ships**; switch `computeSeatLabels` to read the stored
  value. Guard: an oracle test asserting the new label output equals the old function's
  output across the real fixture matrix. Independently valuable — this is the fix for label
  drift under physical signage, with or without hardware.

- **✅ P4 — Parcel edits preserve identity, including RESIZE (I2). DONE 2026-08-16.**
  *Independent of hardware, and a live bug on its own: the rearrange path contains **zero**
  seat creates, so growing a parcel leaves the new positions empty and shrinking strands the
  surplus seats where they stood. Delete-and-recreate is therefore the only way to change
  dimensions — which is what destroys unit identity and would make device reassignment
  routine instead of rare.*
  - **A1 — Resize as a first-class edit.** `syncChairsWithLayout('rearrange')` gains create
    and remove: generate the target grid, match existing seats to positions (by number, as
    today), CREATE seats + units for positions with no seat, DELETE seats whose position is
    gone and prune the units they empty. Overlapping spots keep their seat ids, unit ids and
    persisted ordinals untouched.
  - **A2 — Identity survives re-pairing.** The original P4 scope: extend match-and-preserve
    from geometry to membership, so changing `pairSeats` or the row shape re-uses unit rows
    instead of dissolving and re-minting them.
  - **A3 — Guards.** Oracle test that a NO-OP resize changes nothing (no id churn, no label
    change); tests that grow/shrink preserve every overlapping unit id + ordinal; that shrink
    prunes only the units it empties; and that a shrink refusing to strand seats is asserted
    against real Postgres.
  - **Gate:** partner unit + integration, data suites, browser check of grow and shrink on a
    throwaway site, and the I1 audit still returning zero.

- **☐ P5 — Devices carry a LOCATION, assigned from the partner UI (revised 2026-08-16).**
  Settled after a long design exchange; supersedes the earlier "device binds to an explicit
  seat list" and the interim "device binds to a unit id" shapes.

  **The model.** A device has ONE permanent identity — its printed 6-char code, already the
  key in its potted URL. On first poll it **self-registers** and appears in the partner's
  fleet list, with or without a location. The partner assigns a **seat code (location)** from
  the UI; the assignment is returned in the **telemetry response** and the device stores it.
  Reassignment is the same action. The server resolves location → the unit at that address →
  state, so the device is always reporting the spot it is standing at.

  **Why this shape.** The founder's framing decided it: *"a certain parasol does not have
  intrinsic identity — where in the parcel to find a customer party is the identifying
  factor."* The location is the domain entity; the parasol is fungible; and so is the device.
  Two consequences fall out: a spare from the box is usable anywhere (assign it, done — no
  bench, no reflash), and placement stays checkable by eye if enclosures carry a location
  label.

  **The one hard rule: the URL key stays the device code, never the location.** The URL is
  potted and unreachable after installation; keying it by something reassignable means a
  reassigned device either 401s or, worse, serves a stale location. Identity in the URL,
  location in config.

  **The flashing model (decided 2026-08-16).**

  | | Set at | Changes | Carries |
  |---|---|---|---|
  | **Device code** (6-char Crockford) | bench, permanent | never | the identity in every `state` and `telemetry` request — the URL key is unchanged from what already ships |
  | **Customer number** | bench, permanent | bulk reflash on return only | which partner's fleet list it appears in |
  | **Site · parcel · row · position** | server, via the **state (poll) response** | any time, from the UI | the spot whose state it renders |

  The code is deliberately NOT load-bearing on the daily path — once a device has a correct
  location, resolution runs through that. It earns its place in the three states where things
  are wrong or have not happened yet: **unconfigured** devices (twenty identical new units
  need a handle before "assign this one" means anything), **conflict** (two devices claiming
  one location cannot be told apart BY that location — which is exactly what is broken), and
  **per-board history** (a repeatedly-failing unit vs a repeatedly-dark spot: warranty, RMA,
  bad batches). It costs nothing — already printed, already the URL key.

  Accepted trade-off on the permanent customer number: devices are customer-specific stock,
  so an RMA swap or resale between customers is a **bulk bench reflash**. Fine because they
  are sold outright; it would be friction under a lease/refurbish model.

  Because location is programmable, a device must stay reachable when its location is WRONG —
  which is the second reason identity lives in the URL and location lives in config.

  **What it needs.**
  - `Device` gains an assigned location + last-seen/battery/RSSI (P5 of [[track:019]] — its
    telemetry stub persists nothing today, so the fleet list has nothing to render; that work
    is now a PREREQUISITE, not a follow-up).
  - Wire contract: **config rides the STATE (poll) response, not telemetry** (decided
    2026-08-16). The poll is the fast channel — it must be, to turn a bed red within ~60 s —
    while telemetry is battery-constrained and infrequent, so config there would make
    assignment a wait-and-hope flow instead of an interactive one. It also costs nothing
    extra: the poll happens anyway, whereas receiving config on telemetry forces an extra
    radio wake. **The existing ETag design makes it correct for free**: the route hashes a
    `stable` object (deliberately excluding `serverTime`), so putting the assignment inside it
    means a change busts the ETag and the device gets a 200 with new config, while an
    unchanged assignment keeps returning 304s — preserving the 304 discipline that matters at
    fleet scale.
  - **Telemetry confirms rather than pushes**: the device reports the location it is actually
    running, so the fleet UI can distinguish ASSIGNED from APPLIED (a device that is asleep,
    out of range or dead shows as unacknowledged). Each channel does what it is good at.
  - **Delivery is DECLARATIVE, not event-based.** The assignment is present in every `200`
    body — but not on every poll: an unchanged response is a bare `304`, so it costs nothing.
    It rides along whenever anything changes (seat state included, not just a reassignment),
    which is what makes it **self-healing**: a device that rebooted, lost NVS, was out of range
    during the change, or was swapped for a spare converges on its next `200` with no
    acknowledgment protocol and nobody noticing there was anything to fix. Sending only on
    change would require tracking what each device has acked, and would leave one that missed
    the single transmission stale indefinitely — lighting the wrong bed while the UI insists it
    is assigned.
  - Firmware rule (the other side of that coin): the same config arrives repeatedly, so apply
    it idempotently — write NVS only when it differs, or the device rewrites the same value
    all season and burns flash.
  - Assignment must be **operator-initiated and identify-confirmed**, never inferred. Silently
    re-pointing a device is the one failure that makes a light lie about a bed.
  - An assigned location with **no unit** (parcel shrank, spot dismounted) reads amber/
    unavailable — never FREE.
  - I5 restated: dismounting a spot that still has a device assigned must warn or refuse —
    unassign first.
  - Reconciliation views fall out for free: polling-but-unassigned, assigned-but-never-polled,
    silent >24h, and spots with no device.

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

1. **Q1 — Device↔location cardinality.** One device per location is the assumed shape. Still
   open: may two devices share a location (a wide canopy), and may one device cover two
   adjacent locations? The assignment model makes this a UI question rather than a schema
   one — a location field on `Device` is 1:1, a join table is n:m. *Blocks P5.*
2. **Q2 — LED segment mapping.** With a location assigned, segment order derives from the
   unit's member order at that address. The open case is a device mounted rotated relative to
   the numbering, which derivation gets backwards; a per-device "reverse segments" flag is the
   cheap answer, and the failure it prevents is a lit-up wrong bed. *Blocks P5.*
3. **Q3 — Label scheme.** Keep the composite `{parcel}-{row}{unit}-{member}` with a
   persisted unit number, or move to a flat per-site unit number ("parasol 42")? Affects
   signage, staff speech, and anything already printed. *Blocks P2's backfill shape.*
4. **Q4 — What do today's multi-member groups mean?** Physical (under one shade) or
   commercial (sold together)? If both, the physical unit is a subset of grouping and P3's
   backfill must split them. *P0 answers this empirically.*
5. ✅ **Q5 — Empty units. RESOLVED 2026-08-16 (founder):** a unit with no members is deleted,
   permanently — **deleting every seat IS dismounting the parasol**. There is no "stow" state
   to model, because a broken or seasonal bed is disabled/blocked in the manage UI, which
   keeps its row (verified: `blockBed` writes a blocking reservation with the sticky
   out-of-service sentinel; it never deletes the seat or changes its status) and therefore
   keeps its unit and, later, its device binding. Units and parcels are long-lived, created
   two seats at a time. The ONLY conditionality this leaves for P5 is I5's guard: a unit with
   a device bound cannot be deleted at all — unbind first, as you would unscrew the device
   before removing the pole. Pinned by an integration test asserting an out-of-service seat
   keeps its unit.
7. **Q7 — Copy: does "paired" survive?** The seat toolbar still shows a "· paired" badge,
   now meaning "this seat's unit has more than one member". It is accurate, but the
   vocabulary is moving to units/pitches, and user-facing copy is founder-reviewed
   (`.claude/rules/deploys.md`). Rename, keep, or drop.
6. **Q6 — Site deletion.** With I5's Restrict, deleting a site with bound devices fails.
   That is arguably correct (hardware is installed there) but needs an explicit operator
   path: unbind the fleet first.

## Log

- **2026-08-16 — P4 A2 shipped: re-pairing REUSES unit rows instead of dissolving them.**
  Changing a parcel's shape used to dissolve every affected unit and mint fresh ones, throwing
  away the id, the persisted ordinal, and (once assigned) the device location — for a change
  that only rearranges which beds share a spot. Now a pair reuses one of its members' existing
  units and only genuinely new pairs mint; units left with no members are pruned.
  **The edge case was the interesting part.** Reuse introduced a bug the dissolve strategy
  could not have: if the claimed unit held a member NOT in the new pair, that seat stayed,
  producing a THREE-bed unit — which on a two-bed parasol would light a segment for a bed that
  is not there. Found by constructing the case deliberately (prior unit {1,3}, new pair (1,2))
  rather than by luck; fixed by evicting non-pair members, who are then given their own unit.
  **An existing test had to be re-pinned, not deleted:** the crossed-legacy-groups test
  asserted the old groups were DELETED, which encoded the dissolve STRATEGY rather than the
  guarantee. Its actual purpose — the historical P2025 double-delete crash — is now satisfied
  by construction, since nothing is deleted; it asserts reuse plus correct adjacent pairing.
  Honest test accounting: of the two A2 tests, **one fails on the old code** (the regrouping
  case) and one passes (unchanged pairings already hit track 020's fast path), so the latter
  is a preservation guard rather than a bug-revealer.
  Gates: partner 1992u + 242i, data 374u, tsc + lint clean, editor browser-verified, I1 zero.
- **2026-08-16 — P4 A1 shipped: parcel RESIZE is a real edit.** Growing creates seats (and
  units) for the new positions; shrinking deletes the surplus instead of stranding it, and
  prunes the units it empties. Overlapping spots keep their seat ids, unit ids and persisted
  ordinals — the property that will let an assigned device survive a resize. Added a guard the
  delete-and-recreate path never had: **a shrink that would remove a seat with a current or
  future reservation is refused**, naming the count, rather than deleting a bed under a guest.
  **Validated by git-stash against the pre-P4 code: 4 of the 5 tests FAIL there** (grow adds
  nothing, shrink strands, no booking guard, round-trip loses seats) and the no-op test passes,
  which is the correct signature — the tests describe the bug, not the fix. The ratchet from P1
  fired on the new code and was **refined rather than allowlisted**: `where: { pairId: { in }}`
  is a Prisma FILTER, not a write, so object-valued matches are now allowed and only a bare
  scalar counts as resurrection.
  **Non-bug worth recording:** the browser check surfaced 500s from `recomputeSeatLabels` that
  no test could see — the long-running dev server held a Prisma client generated BEFORE the
  `seq` migration, so it rejected the new `sunbedGroup.seq` select. A restart fixed it. Same
  class as track 020's stale-`.next` lesson: a long-lived dev process is not a clean room.
  Gates: partner 1992u + 238i, tsc + lint clean, editor browser-verified, I1 audit zero.
- **2026-08-16 — Config rides the POLL response, not telemetry (founder).** Right call, and
  for three reasons rather than one: latency (the poll is the fast channel by necessity, so
  assignment becomes interactive instead of a minutes-long wait before the identify flash can
  confirm it), battery (the poll happens anyway; receiving config on telemetry forces an extra
  radio wake), and — the neat part — **the existing ETag design makes it correct with no new
  mechanism**. The route already hashes a `stable` object excluding `serverTime`; putting the
  assignment inside it means a changed assignment busts the ETag and is delivered on the next
  poll, while an unchanged one keeps returning 304s. Telemetry keeps the reverse direction:
  the device reports the location it is RUNNING, which is what lets the fleet UI separate
  "assigned" from "applied" for a device that is asleep or dead.
- **2026-08-16 — DEVICE BINDING MODEL SETTLED: location assigned from the UI, not a seat list
  and not a unit id.** A long design exchange, and the founder's framing carried it: *"the
  internal software id space is ephemeral while physical locations are not"* and *"a certain
  parasol does not have intrinsic identity — where in the parcel to find a customer party is
  the identifying factor."* Final shape: a device self-registers on first poll and appears in
  the partner's fleet list; the partner assigns a seat code (location) from the UI; the
  assignment comes back in the **telemetry response** and the device stores it.
  **What each side conceded.** Mine: our unit ids ARE ephemeral today, because delete-and-
  recreate is the only way to resize a parcel (verified — the rearrange path contains zero
  create calls, so growing a parcel leaves the new positions empty and shrinking strands the
  leftovers). That makes id-binding expensive in the workflow the editor actually forces.
  Theirs: pure address-in-firmware would have made a failed device unreplaceable without a
  bench — a spare is only useful for the address it was flashed with — and the assignment
  channel solves that, since any spare can be given any location from the UI.
  **The rule that survives from the id side:** the URL key stays the device CODE. The URL is
  potted; keying it by a reassignable location means a reassigned device 401s or serves a
  stale spot.
  Consequences recorded in P5 above, and in [[track:019]]: its telemetry persistence (P5
  there) becomes a PREREQUISITE rather than a follow-up, because the fleet list is what the
  assignment UI is built on, and its P4 stops being a QR-scanning field flow.
  **Still worth fixing regardless:** parcel resize is a genuine editor gap today — shrinking
  strands seats — independent of any hardware.
- **2026-08-16 — P3 DONE: unit ordinals are persisted; labels stop moving when neighbours
  change.** Additive migration `20260816090400_add_sunbed_group_seq` (one nullable column).
  `computeSeatLabels` now reads a unit's stored ordinal verbatim and only falls back to
  positional order for units that have none — which is why the whole existing data suite
  passed unchanged. New `computeSeatLabelsWithUnits` also returns the ordinals so
  `recomputeSeatLabels` can persist any that were missing, seeded from TODAY's positional
  order. **Proof on the local 4 592-seat DB: 2 305 units went from 0 to 100 % assigned and
  exactly ZERO label rows changed** (full before/after diff). Three integration tests pin the
  behaviour that motivated the phase: inserting a unit between two others does not rename the
  one to its right, removing a unit leaves a deliberate gap rather than renumbering, and the
  first recompute changes nothing. **The mock-contract meta-guard earned its keep** — it
  failed the moment the new export existed without a stub, which is exactly the silent-drift
  class it was built for. Gates: data 374u + 353i, partner 1992u + 233i, user 539u + 102i,
  admin 174u, tsc clean, `migrate:check` reports no drift. **User ops:** `migrate:test` before
  any `main` push (shared test DB, pre-push hook enforces), then `backfill:units:test` and
  `:production` to assign ordinals (both now also report units without one).
- **2026-08-16 — Backfills applied by the founder to TEST and PRODUCTION; both verified
  consistent.** Test: 24 units created across 3 sites. Production: no unitless seats (I1
  already held) and the 2 orphaned empty units pruned. Independent read-only confirmation
  afterwards — test 456 placed / 240 units, production 1102 placed / 551 units, **zero
  unitless and zero empty in both**. The arithmetic reconciles (test = 216 pairs + 24 new
  singletons = 240 units; production = 551 pairs × 2 = 1102 seats), so P2's data half is
  complete in every environment.
- **2026-08-16 — Q5 RESOLVED: an empty unit means the parasol is dismounted.** Founder's
  rule, and it dissolves the "winter stow" problem I had been carrying since the design
  conversation: a broken or seasonal bed is **disabled/blocked in the manage UI, not
  deleted**, so it keeps its row and its unit. Verified that this holds in the code —
  `blockBed` writes a blocking reservation with the sticky `OUT_OF_SERVICE_TO` sentinel and
  never touches the seat row or its status — which is what makes permanent pruning safe
  rather than lossy. So today's behaviour is the final behaviour: units are pruned when their
  last member is DELETED, and the only future conditionality is I5's guard (a unit with a
  device bound cannot be deleted; unbind first). The hedged "revisit when devices arrive"
  notes in the script and helper are replaced with the rule, and an integration test pins
  that an out-of-service seat keeps its unit — the distinction the whole rule rests on.
- **2026-08-16 — Founder: "there is no indication of a group that does not have seats
  anywhere." Correct, and PRODUCTION carries 2 of them.** Measured read-only: dev 0, test 0,
  **production 2 empty units on one site** — residue of the parcel-delete bug fixed an hour
  earlier (`deleteItemsByGroup` removed seats and left their units behind forever). They
  reference nothing, nothing references them, and no surface shows them, so they were
  invisible garbage. The consistency script now reports and prunes them alongside the I1
  backfill; `--dry-run` against production confirms exactly 2 on site
  `cmowodzrk000004l21bo1ge9v`. **User op:** `npm run backfill:units:production` (also
  `:test`, currently a no-op) — proposed, not run, since it writes to production.
  **The deeper point stands for P5:** once a device binds to a unit, an empty unit becomes
  LEGITIMATE (a shade whose beds are stowed for winter) and must be visible in the editor
  rather than pruned — at which point pruning has to become conditional. Recorded in Q5; the
  script carries a note to revisit it then.
- **2026-08-16 — Founder question ("does deleting the last item delete the group?") exposed
  THREE delete bugs, all now fixed.** The answer was yes for the last member — but the
  behaviour in between was wrong in ways that would have been fatal once devices bind to
  units. Proven against real Postgres before touching anything: (1) `deleteInventoryItem`
  detached EVERY sibling from the unit before deleting the target, so removing one bed of a
  pair left the survivor with a null group — an I1 violation — and destroyed a unit that
  still had a bed standing in it; (2) the bulk delete did the same, set-based; (3)
  `deleteItemsByGroup` deleted a parcel's seats and left its units behind as empty rows
  forever (4 orphans from an 8-seat parcel). Fixed by the rule that **deleting a BED is not
  deleting the UNIT**: delete only the selected seats, then `pruneEmptyUnits` (new, shared,
  in `@repo/data/unit`) removes only units that lost their LAST member. Every delete path now
  routes through that one function, which is where P5's "refuse to delete a unit with a
  device bound" guard will live. Three tests were re-pinned from "detaches siblings" to
  "siblings keep their unit", and four new integration tests cover the pair-survivor case,
  its bulk twin, last-member pruning and parcel cleanup. Gates: partner 1992u + 232i, data
  374u, tsc + lint clean.
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
