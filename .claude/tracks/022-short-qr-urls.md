---
id: 022-short-qr-urls
title: Short QR URLs — address-keyed POS entry
status: active
created: 2026-08-20
updated: 2026-08-20
worktree: null
---

## Goal

Make the printed POS/QR URL short enough to scan reliably at arm's length in glare and
wind, and re-key it from two opaque cuids onto identifiers that name something physical.

```
now      https://sunbnb.app/sites/cmbhmy2uu000012zrrzih3zzu/pos/cml3nu1r9000sf95miujpyzrd
         └ 18 ┘└  7  ┘└──── cuid 25 ────┘└ 5 ┘└──── cuid 25 ────┘         80 chars
after    https://sunbnb.app/q/S-K7M2X9/1-1-1                               35 chars
```

Two cuids are 50 of the 80 characters, and neither carries information the page uses.
At the production host that is QR **byte-mode version 5 (37×37 modules)** today — version
6 / 41×41 on `test.sunbnb.app`, which is 5 characters longer — against **version 3
(29×29)** after. At a fixed printed card size that is ~1.3× larger modules, which is the
whole point: the card is glued to a lounger and read by a phone at an angle in sunlight.

The second, quieter win is vocabulary. `1-1-1` is the same unit address `formatSeatId`
already prints on the card, the same address a device answers for ([[track:019]]), and the
same `UNIQUE(site_id, parcel, row_idx, seq)` key [[track:021]] made canonical. After this,
the string on the bed, the string in the URL, and the string in a support call are one
string — and it can be read aloud and typed.

## Resume here

- **▶ NEXT ACTION: nothing for an agent — the track is waiting on USER OPS.** All build
  phases (P1–P4) and P5's documentation are done and green; nothing is committed yet.
  1. `npm run migrate:test` (the pre-push hook blocks a `main` push while
     `20260820101055_add_site_code` is pending on the shared test DB), then
     `npm run backfill:site-codes:test`.
  2. **Print a real sheet from the partner inventory tab and scan it from a metre away.**
     Every length and QR-version claim here is arithmetic; the deliverable is a card in
     sunlight, and it has not been checked on paper.
  3. Production backfill + any reprint waits on [[track:021]]'s address migration.
- **If picking work up instead:** Q1 is open — the print loop stays per-SEAT by default (a
  pair's two cards now share one QR target while keeping distinct labels); switching to one
  card per unit is a one-line change in `qr-print-button.tsx`. Q3 (rate-limiting `/q/*`) and
  Q4 (surfacing `Site.code` in the partner UI) are untouched.
- **Context needed:** this file · `.claude/rules/migrations.md` (shared test DB) ·
  `packages/data/package.json` (`backfill:site-codes:*`).
- **Do NOT** re-derive availability anywhere new. Both POS entry points share
  `posAvailability` in `sites/[id]/pos/[itemId]/queries.ts`, which delegates to the
  canonical `getAvailabilityForItems`.

## Decisions (founder, 2026-08-20)

- **D1 — Spot binding is correct.** The card is bound to the *place*, not to the seat row.
  Rebuild a parcel at the same spot and the card keeps working; the trade is that a genuine
  rearrange (`recomputeSeatLabels` rewrites unit addresses) can re-point a card at a
  different bed. This is [[track:021]]'s paradigm — position is the identity — and it is
  already how a device resolves. Consistency here is worth more than the cuid's row-follows
  behaviour, which fails on the far more common event (a parcel rebuilt in place).
- **D2 — `Site.code` is a new column, 6-char body with an `S-` prefix** (`S-K7M2X9`).
  32⁶ = 1,073,741,824. The prefix exists for the same reason `partner-code.ts` has one:
  short Crockford strings sitting next to each other in a support conversation get
  confused. 6 matches `Device.code`; only `PartnerAccount.code` stays at 5.
- **D3 — No member suffix.** The URL names the unit, not the bed. Ignored data must not be
  printed. `1-1-1-2` remains a strict superset, so accepting it later is backward
  compatible with every card already in the field — deferring costs nothing.
- **D4 — No uppercase/alphanumeric-mode trick.** At 6 chars the worst case (38) sits inside
  byte-mode v3's 42-char cap, so forcing the whole URL uppercase to reach alphanumeric mode
  buys the same 29×29 symbol for a permanent case-insensitivity complication. Rejected.
  (It only paid while the URL was under 38 characters — i.e. only at a 4-char site code.)
- **D5 — Old routes are kept permanently as redirects**, not removed. Cards are already on
  beds. Precedent: `/sites/[id]/dine/[tableId]` → `/tables/[tableId]`.

## Findings (verified 2026-08-20)

- **The item cuid carries nothing.** `getPosContext` uses `itemId` only to reach
  `item.sunbedGroup`, then renders the unit's placed members ordered by seat number —
  deliberately, "so the picture is the same whichever bed's QR was scanned". A URL ending
  `-1` and one ending `-2` render byte-identical output.
- **The unit address is a complete key.** Across local, test and production: **0 placed
  seats with no `sunbed_group_id`**, and (local + test, which have the columns) **0 units
  missing an address**. The "singleton / ungrouped seat" branch in `seat-label.ts` has no
  instances in any environment. Local: 2,305 units / 4,586 placed seats, max parcel 13, row
  15, seq 25 — so `13-15-25` (8 chars) is the realistic worst case.
- **`Site.slug` cannot be the print key.** Only **1 of 15 production sites** has one; the
  column is a bare `String?` with **no `@unique` constraint** (uniqueness is app-side in
  `checkSlug` only); it is partner-editable on the brand page, so a rename silently kills
  every card at that venue; and it is variable-length, which gives back what the cuid
  removed. Keep it as an accepted *alias* in the route slot — `pos/page.tsx:6` already
  matches id-or-slug — but never print it.
- **Length budget** (production host, `sunbnb.app`): `https://sunbnb.app/q/` = 21 chars,
  `S-XXXXXX` = 8, separator 1, address 5–8. Typical **35**, worst **38**, against byte-mode
  ECC-M v3's cap of 42 — 4 characters of margin. A venue reaching parcel 100+ or a 3-digit
  seq spills that one site to v4 (33×33): denser card, not a failure.

## Deployment constraint

Production is behind on [[track:021]]. `SunbedGroup` there has `id, site_id, createdAt,
updatedAt, seq` — **no `parcel`, no `row_idx`** — and `PartnerAccount.code` does not exist
there either. The address this track keys the URL on is **not in the production database
yet**.

That blocks nothing on `main` (local and test are fully addressed), but it does mean no
short card can be printed for a real venue until 021's address migration lands. Since
`Site.code` is another nullable-unique-plus-backfill column, the cheapest path is to let P1
ride the same expand wave rather than open a second one.

## Roadmap

- ✅ **P1 — `Site.code`** (2026-08-20). Nullable-unique column + migration
  `20260820101055_add_site_code` (local + `sunbnb_test`) · `src/site-code.ts` (+21 unit
  tests) · `scripts/backfill-site-codes.ts` + six env-tiered npm scripts, run on local (6
  sites) and idempotent on re-run · minting on BOTH partner creation paths via
  `apps/partner/lib/site-create.ts` (+7 tests). No `PrismaCient` mock change needed (the
  mocks are per-method, not per-field; `mock-contract` green).
- ✅ **P2 — Resolver** (2026-08-20). `parseUnitAddress` added to the pure
  `@repo/data/unit-address`, beside the formatter it inverts (+15 tests, incl. the
  format→parse round trip and the `1-1-1-2` superset). `apps/user/app/q/resolve.ts`
  `resolveQrTarget(code, address)` → `{ site, items }` or null: syntax checked before any
  query, code folded through `normalizeSiteCode`, unit fetched by `unitAddressWhere` on the
  unique index, `pool` spares excluded, seats ordered by `number` (+15 tests).
- ✅ **P3 — Routes** (2026-08-20). `/q/[site]` and `/q/[site]/[unit]` in `apps/user`, both
  rendering the EXISTING `PosView` components — no second copy of either page. Legacy routes
  redirect (query params preserved) with a deliberate fallback; the venue loader was
  extracted to `sites/[id]/pos/queries.ts` `getPosSite` and the seat loader split into
  `loadPosUnitByItem` + the shared `posAvailability`, so `getPosContext` keeps its contract
  and its integration tests. `app.tsx` chrome list extended with `startsWith('/q/')`.
  +19 unit tests (2 route pages, 2 legacy pages) and +8 integration tests against the real
  unique index. Browser-verified against the running dev app.

- ✅ **P4 — Print** (2026-08-20). `inventory/qr-url.ts` `qrCardUrl` (+6 tests) builds the
  short URL by unpacking the item's `seatLabel` — no payload change, since the label already
  carries the address (the same trick track 021 used for display). Falls back to the legacy
  long URL rather than refusing to print. `qr-print-button.tsx` takes `siteCode`; both
  callers pass `site.code`; `SiteProps` gained the field.

- ▶ **P5 — Ops + docs.** Docs DONE: `packages/data/CLAUDE.md`, `apps/partner/CLAUDE.md`,
  `apps/user/CLAUDE.md` (route map + test lists) and the wiki ingest (patch to
  `entities/reservation.md`'s creation-paths row; `physical-identity` queued under Planned
  with a hold — see `.claude/wiki/log.md`). The two demo QR URLs stay on the legacy form
  DELIBERATELY (they target `test.sunbnb.app`, whose codes do not exist yet; hardcoding an
  environment-specific code in source is worse than a redirect). **Remaining, all USER OPS:**
  (1) `npm run migrate:test`, then `npm run backfill:site-codes:test`; (2) **print a real
  sheet and scan it from a metre away** — every length and QR-version claim in this track is
  arithmetic, and the deliverable is physical; (3) production backfill after [[track:021]].

- 💤 **Backlog.** Warn the partner in the inventory editor when a rearrange changes unit
  addresses that have printed cards (the D1 trade made visible). Accept `1-1-1-2` and
  preselect the scanned bed, if the UX ever wants it.

## Open decisions

- **Q1 — One card per unit, or keep one per seat?** The print loop is currently per item,
  so a pair under one parasol yields two cards whose QRs would now be identical (labels
  still differ). Per-unit halves the paper; per-seat keeps a card on each bed. Founder call
  — affects P4 only.
- **Q2 — Does the venue QR move too?** `/q/{site}` would replace `/sites/{id}/pos` for the
  venue-wide map. Same redirect story, but venue cards are fewer and may not be worth
  reprinting.
- **Q3 — Rate-limit `/q/*`?** At 6 chars a sweep finds a live venue once per ~1M probes, so
  enumeration is not the concern; cost-abuse of a public read is. Same posture as the HW
  route's Q9 (public data, edge rate limiting as the backstop) — decide whether to do it
  now or inherit it with [[track:020]] Q4.
- **Q4 — Surface `Site.code` in the partner UI?** Support cannot read a code that only
  exists in the database. Likely the site General tab, next to the slug.

## Log

- **2026-08-20 — Scoped.** Founder asked to shorten the POS URL, proposing the group
  address as the key. Verified the item cuid is used only to reach the group, that the
  address key is complete on all three environments, and that `slug` is not printable.
  Sized the site code against the QR version boundaries: at a 4-char body the worst case
  lands exactly on 38 (alphanumeric v2, 25×25); founder chose **6** (D2), which puts the
  worst case at 38 in byte mode — inside v3's 42-cap — and thereby made the uppercase trick
  worthless (D4). Member suffix dropped as ignored-data-in-print (D3). Spot binding
  confirmed by the founder as correct (D1). Written up as its own track; P1 should ride
  [[track:021]]'s expand wave to production.

- **2026-08-20 — P1 done.** `Site.code` shipped end to end: schema + migration, the pure
  `site-code.ts`, the backfill, and minting on create. Four decisions taken while building,
  none of them worth re-opening:
  - **The mint lives in the partner app** (`lib/site-create.ts`), not in `packages/data`.
    `site-code.ts` must stay client-safe (no prisma — the rule that bites only at
    `next build`), and both writers are partner actions. The invariant is app-local by
    choice; the idempotent backfill is the net under it.
  - **`isSiteCodeCollision` exists so the retry cannot swallow a different constraint.**
    `Site` has other unique columns (`restaurantId`); retrying one of those five times with
    fresh codes would report the wrong cause, late. An unattributed P2002 is treated as a
    collision so creation is never stranded.
  - **Prefix-optional validation is deliberate and asymmetric.** `isValidSiteCode('NWJMDB')`
    is true — a bare 6-symbol device code satisfies a site body. Harmless, because the
    lookup it feeds is scoped to the `Site` table and simply finds nothing; the value is
    that a hand-typed `/q/k7m2x9/1-1-1` resolves. Pinned by a test that says so, so it
    reads as chosen rather than overlooked. Tighten HERE if it ever stops being harmless —
    never in `normalizeSiteCode`, which the routes need forgiving.
  - **The migration was hand-written from `migrate diff` output.** `prisma migrate dev`
    refuses to run non-interactively when it raises a warning (here: adding a unique index),
    so the SQL came from `migrate diff --from-config-datasource --to-schema --script`
    verbatim into a conventionally-named folder, then `migrate deploy` to local and
    `sunbnb_test`. `migrate:check` reports no difference.
  - Corrected while writing: the earlier claim that widening the body to 8 would push the
    URL past QR version 3 is wrong — the worst case is 38 against a 42-char cap, so the body
    could reach 10. The margin is reserved for a longer unit ADDRESS instead, and that is
    what the budget tests now assert.
  Green: data 463u / 378i, partner 2040u, lint clean, `migrate:check` clean.

- **2026-08-20 — P2 done.** Resolution is now a single tested call, split pure/DB:
  - **The parser lives next to the formatter it inverts**, in `@repo/data/unit-address`.
    That module exists because three parties re-deriving one address is how they came to
    disagree about it; a parser written anywhere else would be a fourth opinion on the same
    string. The round trip `parse(format(x)) === x` is asserted, so the URL and the card
    cannot drift apart.
  - **It checks syntax, not domain bounds** — and that is not pedantry. Real data (local
    AND test, 21 units each) sits at **parcel 0, row 0**, so a parser that "sensibly"
    required 1 would have 404'd every card printed for them. The DB decides what exists;
    the parser only decides what is a well-formed string. It does cap values at int4,
    because past that Postgres throws and a mistyped URL becomes a 500 instead of a 404.
  - **The four-part key is asserted explicitly.** `seq` restarts in every row, so a key
    missing `row` resolves a NEIGHBOURING row's unit and serves a guest someone else's bed
    with nothing in the response to hint at it. Verified by injecting exactly that defect:
    2 tests fail, no collateral.
  - **Declines rather than serving an empty unit**: unknown code (and then the unit query
    never runs), no unit at the address, or a unit whose only members are `pool` spares. A
    page offering zero beds is worse than a 404, because it looks bookable.
  - Malformed input is rejected **before** any query — scanners and crawlers are the common
    source of it, and it should cost a regex.
  Green: data 478u (+15) / user 609u (+15), lint clean.

- **2026-08-20 — P3 done, browser-verified.** Both short routes are live locally and the old
  ones redirect into them.
  - **The old routes redirect CONDITIONALLY, and that is the load-bearing decision.** The
    short form needs two things an environment may not have yet: a backfilled `Site.code`,
    and [[track:021]]'s unit address (production has neither column). An unconditional
    redirect would send every card already glued to a lounger to a URL that resolves to
    nothing — an outage created by a deploy, not by a bug. When either is missing the page
    renders exactly as before. That is a fallback, not a second implementation: both paths
    share `getPosSite` / `posAvailability`, and both fallbacks have a test.
  - **The new pages render the EXISTING `PosView`s** (imported across route folders, the
    `/s/[slug]` → `sites/[id]/view` precedent). The seat loader was split so the ONE
    availability tail is shared rather than copied; `getPosContext` kept its signature so
    the 14 POS integration tests still guard it unchanged.
  - **Verified in the running app**, not just in tests: `/q/S-MKV0ZJ/1-1-1` renders the unit;
    `/q/mkv0zj/1-1-1` (lowercase, prefix-less) resolves; `/q/S-MKV0ZJ/99-99-99`,
    `/q/S-ZZZZZZ/1-1-1` and `/q/not-a-code/1-1-1` all decline; the legacy seat and venue URLs
    both 307 into the short form, carrying `?anonId=` across.
  - Two false alarms worth recording so nobody re-chases them. **A `redirect()` here answers
    200, not 307, to `curl`** — Next serialises the redirect into the RSC payload (`;307;`)
    and the client performs it; the shipped `/sites/[id]/dine/[tableId]` alias behaves
    identically, which is how it was confirmed as framework behaviour rather than a defect.
    And **`9-9-9` is a real unit** at the dev site, so it correctly rendered a page instead
    of the not-found card — the address space is denser than a made-up "obviously invalid"
    example assumes.
  - Also found: the dev server had been running since before P1, so its Prisma client
    predated the `code` column and every site read back `code: undefined` — the redirect
    silently never fired. Restarting it fixed it. A stale process, not a code path, but it
    looks exactly like the fallback working.
  - **Deviation from the P3 plan:** the two hardcoded demo QR URLs (`app/demo/page.tsx:138,140`)
    were left on the legacy form. They point at `test.sunbnb.app`, whose site codes will not
    exist until `backfill:site-codes:test` runs, and hardcoding an environment-specific code
    in source is worse than a redirect. They keep working via P3's redirect; revisit in P5.
  Green: user 628u (+19) / 111i (+8), lint clean, tsc clean.

- **2026-08-20 — P4 done.** The printed card now carries the short URL.
  - **Q1 answered by defaulting to no change.** The print loop stays per-SEAT: a pair's two
    cards now share one QR target but keep their own visible labels. P4's scope is "emit the
    short URL", not "redesign what an operator glues to a bed" — and the conservative option
    is reversible in one line if the founder wants the paper halved. Flagged, not silently
    decided.
  - **The address comes from `seatLabel`, not from new payload fields.** The stored label
    packs the same four numbers (`2-302-1` → `2-3-2`), so `parseSeatLabel` + `formatUnitLocation`
    gets there without shipping `parcel`/`row`/`seq` columns to the client — which would have
    undone [[track:020]] C2's payload cut. Pinned by a test asserting the unpack, because
    printing the packed form (`2-302`) would 404 every card at the venue.
  - **It falls back, it never refuses.** No site code (pre-backfill) or an unparseable label
    prints the legacy URL, which still resolves and redirects once both halves exist. The
    alternative — blocking the print — would strand an operator on a platform migration they
    cannot see, to avoid a URL that merely scans from slightly closer.
  Green: partner 2046u (+6), tsc clean.

- **2026-08-20 — P5 docs done; rollout is user ops.** CLAUDE.md tree synced (data, partner,
  user) and the wiki ingest run. The ingest is mostly a record of what was NOT written:
  - **One patch earned its place** — `entities/reservation.md`'s creation-paths row pointed
    at `sites/[id]/pos/...`, which would have sent an agent to build against the legacy
    route. Everything else this track changed fails the wiki gate: the QR-density work is
    performance-shaped, the loader split is a refactor, and the new tests guard existing
    behaviour.
  - **No new page, on purpose.** The load-bearing new rule (a card binds to the SPOT, not a
    seat row) belongs with the external-code family and the shared unit address, which now
    has two consumers and has earned a page under the two-strikes rule. But [[track:021]] is
    mid-expand and production still lacks the columns, so a page written today would
    document a moving model. Queued under Planned in `index.md` with the hold recorded.
  - **`last_verified` deliberately not bumped** on the patched page: only the row touched was
    re-checked, and bumping would claim a freshness the pass did not earn. Noted in passing
    that its invariant 6 still describes transitions without mentioning the track-018
    machine — thin rather than false; left for a pass that verifies the whole page.
  - The demo QR URLs stay legacy (see P5). They keep working through the redirect.

## Links

- [[track:021]] — physical unit model; owns the `SunbedGroup` address this track keys on,
  the `partner-code.ts` pattern P1 copies, and the production migration P5 waits for.
- [[track:019]] — HW API; resolves a device by the same address via the same
  `unitAddressWhere`. The QR and the device now agree on what names a spot.
- [[track:020]] — large-venue scale; Q4 (rate-limit the public availability endpoint) is
  the sibling of Q3 here.
