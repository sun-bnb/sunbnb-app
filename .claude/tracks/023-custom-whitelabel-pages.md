---
id: 023-custom-whitelabel-pages
title: Custom whitelabel pages — bespoke brand experiences for key customers
status: active
created: 2026-08-21
updated: 2026-08-21
worktree: null
---

## Goal

Sell a **hand-crafted brand experience** to important customers: a per-site whitelabel page
that looks designed rather than themed, switched on from the admin UI, and rendered from
artefacts authored per site — without forking the booking funnel to get it.

Today `/s/[slug]` renders the standard `SiteView` with five brand fields
(`brandName`, `tagline`, `bgColor`, `fgColor`, `logoUrl` — `apps/user/app/sites/[id]/view.tsx:69`).
That is a *theme*, not a brand experience: same layout, same order, same components, different
colours. For a flagship customer the ask is different — their own hero, their own sections,
their own voice, their photography, possibly their typography.

End state: a small number of sites render a bespoke page; the rest are unaffected; and the
bespoke ones still book, pay, and reconcile through exactly the same machinery as everyone
else.

## The premise that shapes every other decision

**The whitelabel page is not a brochure. It is the booking funnel.**

`/s/[slug]` mounts real machinery: availability for the venue's civil day, seat selection
(unit-granular or per-seat per `partialGroupBookingEnabled`), the mobile reservation drawer,
anonymous `anonId` identity, the in-page payment step, and the reservation flow behind it.
A customer who buys a "custom page" is not buying a landing page — they are buying *their
storefront*, and it has to sell.

Every artefact format has to be judged against that first:

| Format | Design freedom | Keeps the booking engine? |
|---|---|---|
| More `SiteBrand` colour fields | low | yes |
| Structured block document (JSON) | medium | yes, if a `booking` block mounts it |
| Per-site React module in the repo | high | yes |
| Uploaded HTML/CSS bundle rendered in an iframe | high | **no** — loses session, Redux, the drawer, i18n |
| Uploaded HTML injected into the page | high | **no** — and it is an XSS surface under our own origin |

The last two are what "artefacts created manually" first suggests, and they are the two that
fail. So the shape is **custom shell, shared engine**: the artefact owns everything around
the booking surface, and the booking surface stays one component the platform maintains.

## Decision (founder, 2026-08-21)

**D1 — the artefact is a per-site React module in this repo.** Git is the versioning, code
review is the safety net, the design system is right there, and there is no runtime
sanitisation surface. This answers Q1 (a developer authors it) and, by accepting the repo as
the home, Q2 (a customer-visible change ships on the normal `commit → push → promote →
deploy` ladder).

Two consequences worth stating plainly, because they are the price of the choice:

- **A hero-copy tweak is a deploy.** There is no CMS behind this and no admin text field. For
  a flagship customer that is usually fine — they are buying a designed page, not a blog —
  but "change this line by Friday" costs a release, not a save.
- **The block-document tier is now unnecessary**, not merely deferred. Its whole purpose was
  to give non-developers layout freedom without a deploy; with D1 that constituency does not
  exist. It stays in the backlog only for the day volume makes hand-authoring the bottleneck.

### D2 — the brand tab exposes a field iff that field is still in effect (founder, 2026-08-21)

When a custom brand page is **enabled AND its module exists**, the partner's brand tab stops
offering the token editor and states the fact instead: this site runs a custom brand page,
here is its public URL.

**The slug is the exception, and it stays editable** (founder, correcting the first reading of
this). The slug is not presentation — it is the address. It remains in effect no matter who
renders the page, it is the customer's own URL, and a rename cannot orphan anything because
the registry is keyed by `Site.code`, not by the slug. That keying decision was made to stop a
rename silently dropping a customer back to the standard page; the dividend is that renaming
stays safe, so there is no reason to take it away.

Generalising the correction rather than patching it:

> **The brand tab exposes a field if and only if that field is still in effect for what the
> guest actually sees.**

That single rule produces every case:

| Field | Custom page live? | Editable | Why |
|---|---|---|---|
| slug | yes | **yes** | still the URL — routing reads it regardless of who renders |
| colours, logo, tagline | yes | no | the shell decides its own look; editing what nothing reads is a lie |
| everything | switch on, module MISSING | yes | the standard page is rendering, so the tokens are genuinely in effect |
| everything | switch off | yes | today's behaviour, unchanged |

The fallback row is why the rule is phrased around the *resolved render* rather than the
switch: one resolver answers which page renders and which controls to offer, so the two cannot
drift, and a half-configured site never leaves live controls with no owner.

Consequences worth stating before they surprise someone:

- **`saveBrand` needs a FIELD-level guard, not an action-level one.** It currently takes
  brandName, slug, tagline and both colours in a single call, so "reject when custom is live"
  would take the slug down with the tokens. Cleanest split: a `saveSlug` that is always
  allowed, and token writes rejected while a custom page is live. Both need auth-matrix rows.
- **Read-only UI is not a guard.** A hidden form still posts from a stale tab or a crafted
  request, so the rejection has to live in the action.

### D3 — brands live in the user app, with full access to it (founder, 2026-08-21)

Location: **`apps/user/brands/<name>/`**, outside `app/`. The App Router never walks it, so it
needs no underscore-private convention — it sits beside `components/`, `service/` and `store/`
as what it is, a library that happens to be customer-specific. `@/*` already maps to the app
root, so `@/brands/alcudia` works with no config change.

`packages/brands/*` was considered and **rejected**. It would have given each brand its own
dependency graph and a structurally enforced boundary — and the boundary is precisely what we
do not want. **A brand reaching into app internals is a feature, not a cost:** a shell that
cannot touch the store, a server action, a hook or the i18n messages either re-implements them
badly or forces the platform to grow "brand-safe" APIs nobody else needs. That is a tax paid
for isolation from an adversary that does not exist — brand code is ours, reviewed by us, and
shipped in the same release. Full access is also what keeps a bespoke page *thin*: it reuses
the drawer, the availability read and the translations instead of duplicating them, and
duplication is the real threat to both polish and maintenance.

No eslint import restriction on `brands/**`. It would re-erect by convention the wall we just
declined to build.

The residue to be honest about: brands become **coupled to internals**, so an internal refactor
can break a customer's page. That is not an argument for a wall — it is an argument for a
per-brand smoke test and a booking component with a supported contract, both already in the
plan. The boundary that actually protects a customer here is a failing test, not a forbidden
import.

## How it works

Two gates, deliberately answering different questions:

| Gate | Question | Where |
|---|---|---|
| **Registry entry** | Does a bespoke page EXIST for this site? | the repo — `apps/user/app/s/_brands/registry.ts` |
| **`customBrandEnabled`** | Is it LIVE right now? | `Site` column, switched in the admin UI |

Both must be true, and neither is redundant. The registry alone would mean "merged = live",
with no way to stage a page or pull it without a revert. The switch alone would point at
nothing. Together they give a kill switch that needs no deploy, and a merged-but-dark page
that can be enabled per environment.

```
apps/user/brands/
  registry.ts            static map: Site.code → () => import('@/brands/alcudia')
  alcudia/
    index.tsx            the shell — owns layout, sections, type, imagery
    ...                  brand-local components/assets
```

- **Only the matched brand loads.** The lazy behaviour comes from the IMPORT SHAPE, not the
  location: a static map of `() => import(…)` thunks makes the bundler emit one chunk per
  brand, and the page awaits only the one it matched. Two ways to silently undo it, both worth
  a comment in the registry: a template-literal path (`import(\`@/brands/${code}\`)`) cannot be
  enumerated, so nothing splits; and a barrel `brands/index.ts` re-exporting every brand pulls
  the lot back in through one static import.
- **What "on demand" does and does not mean.** Only the matched brand is evaluated server-side,
  and only its client chunks reach the browser. Every brand still ships inside the deployment
  bundle — a cold-start-size question at dozens of brands, not a per-request one.
- **Unverified until built:** the chunk-splitting is confident from the mechanism but has not
  been demonstrated in this repo's Next 14 setup. P3 builds once and inspects
  `.next/server/chunks` plus the client manifest.
- **Keyed by `Site.code`, not by slug.** The slug is partner-editable from the brand tab; a
  rename would orphan the registry entry and silently drop the customer back to the standard
  page with nothing in the logs. `Site.code` ([[track:022]]) is immutable, short and readable —
  minted for the printed QR URL, and it turns out to be exactly the stable per-site key this
  needs. The DIRECTORY is still named for the customer, because `s-mkv0zj/` tells a developer
  nothing.
- **Fail-safe direction: fall back to the standard page, never to an error.** Switch on but no
  registry entry, or the import throws → render `standard`. A bespoke page failing must cost
  the customer their design, not their bookings. (Same doctrine as [[track:022]]'s conditional
  redirect.)
- **Preview comes free.** Code in the repo means `main` gets a Vercel preview deploy, so a
  customer can approve their page at a preview URL before the switch is ever flipped in
  production. That is Q6 answered by the pipeline rather than by a feature.
- **Tailwind must scan `./brands/**`** — the user app's content globs list `./app/**` and
  `./components/**` only, so every class used only in a brand would be purged from the build.
  Same trap the shared `@repo/*` packages already document.

**Three surfaces need the same answer, so the answer is shared.** The React modules live in
`apps/user`, but the partner app must know whether one exists (D2) and the admin app should
say so honestly. A tiny **manifest** — the list of site codes that have a module, pure, no
React, no prisma — belongs in `@repo/data` beside the other shared identity helpers, with the
user app's registry test-pinned to cover exactly the manifest in both directions. That is the
same reasoning as `unit-address`: three parties that must agree about one fact should not each
derive it. The admin switch then shows the real state rather than the stored one — *enabled and
live*, or *enabled, awaiting code* — the way `/preferences` already warns when an env override
means the saved value is not the effective one.

## What a bespoke module gets, and what it owes

It receives the server-loaded payload the standard page already builds (site, brand, working
hours, rental items, availability count) — the shell decides presentation, never data access.

In return it MUST render, and a review checklist should enforce:

1. the **booking mount** (see below) — the page has to sell;
2. working hours and the legal/footer content;
3. i18n fallbacks for anything not hand-written in the customer's language;
4. page metadata (title/description/OG) — it is a public, indexable storefront.

## Prerequisite nobody can skip

**The booking engine has to become a component with a stable prop contract** before the first
bespoke shell exists. Today it is entangled in `SiteView` (`apps/user/app/sites/[id]/view.tsx`)
with the chrome, header, hours and services. A shell needs to mount *just the funnel*.

Until that seam exists, "custom page" means "a copy of SiteView with edits" — which is N
copies to re-check every time the drawer, the payment step or the seat-selection policy
changes. With the seam, a bespoke shell is a layout that mounts one supported component, and
a smoke test per module ("it mounts the booking component") turns an engine refactor into a
failing test rather than a customer discovering it.

That extraction is the real engineering in this track. Everything else is plumbing.

## Resume here

- **▶ NEXT ACTION: founder review of the Alcúdia page** (`/s/alcudia` locally — the site is
  wired live in the local DB). It is customer #1 of the mechanism: all five phases of this
  track are done. After review: USER OPS `npm run migrate:test` (three migrations queued:
  site code, custom_brand_enabled, custom_brand_key), then commit/push per the deploy ladder.
- **Remaining open questions:** Q6 (does the brand reach the reservations page, receipts, QR
  pass, emails?) and Q8 (read-only panel copy — user-facing, wants copy review). Backlog: P6
  block tier (dead unless volume), P7 brand reach.
- **Engine fix that fell out of P5:** `SunbedSelection` opened the map on the bounding-box
  centre of all seats — in the WATER on a beach that curves, with every seat culled at zoom
  20. Now anchors on the real seat nearest that centre (`inventoryAnchor` in the pure
  `sunbed-preselection.ts`, +4 tests incl. the crescent case). This also closes track 014's
  deferred "recenter map on preselected pair" in spirit: the map now always opens on beds.
- **Do NOT** let the reference module grow into a design; it is the wiring demo and says so.

## Roadmap

- ✅ **P1 — `customBrandEnabled` + the admin switch** (2026-08-21). Additive column
  (migration `20260821080420_add_site_custom_brand_enabled`, local + `sunbnb_test`),
  `setCustomBrand` in `apps/admin/app/sites/actions.ts` (sudo-gated, boolean-typed, +11 tests),
  and a Custom brand column in the admin sites table. Nothing reads the column yet — zero
  behaviour change by construction.
- ✅ **P2 — Extract the booking engine** (2026-08-21). `components/booking/BookingSurface.tsx`
  owns the funnel (sidebar, drawer, scrim, pill, bootstrap, `ReservationView`) behind
  `{ site, apiKey, theme? }`; `SiteView` 403 → 266 lines and is now the page around it. Peek
  arithmetic extracted to the pure `app/sites/[id]/peek-height.ts` (+6 tests, previously
  untested). Browser-verified on both the standard and branded pages.
- ✅ **P3 — The `brands/` mechanism + the shared manifest** (2026-08-21). `apps/user/brands/`
  with a `dynamic()` registry, `BrandMount` client boundary, `types.ts` contract and a plain
  `reference` module; `@repo/data/brand-manifest` (`BRAND_KEYS`, `isKnownBrandKey`,
  `resolveBrandRender`, +8 tests); the fork and fall-back in `/s/[slug]` (+7 tests); registry ↔
  manifest pinned at compile time by `Record<BrandKey, …>` and at runtime by a test (+2);
  Tailwind `./brands/**`; vitest include extended to `brands/**`. Admin gained the module
  select (`setCustomBrandKey`, manifest-validated, +9 tests) and a resolved-state badge. Two
  corrections fell out of building it — the registry key and the splitting mechanism, see Log.

- ✅ **P4 — Partner brand tab follows the effective render** (2026-08-21). `saveSlug` split out
  of `saveBrand` (shared `validateSlug`, registered in the gated-action registry so the auth
  matrix drives it); `saveBrand` refuses token writes while a bespoke page is live, and still
  accepts them in both half-configured states; the tab renders a statement-of-fact panel with
  the slug control instead of the editor. The Business-plan gate is skipped for a bespoke site.
  The false "preview only, won't be saved" banner is gone. +7 tests.

- ✅ **P5 — Customer #1: Alcúdia** (2026-08-21). `brands/alcudia/` — the "bathymetric descent"
  page (dry sand → deepening tinted panels separated by depth-contour lines → a deep-teal
  footer past the sandbar), three typographic voices via `next/font/google` (Bricolage
  Grotesque / Source Serif 4 / Spline Sans Mono), live data throughout (price, bed and parasol
  counts, hours, availability — a source test REJECTS a hardcoded euro amount), the cover
  photo's CC BY attribution finally housed in the footer, and a mobile CTA that opens the real
  drawer through the store. Smoke test = the brand-kit obligations asserted against source
  (BookingSurface mounted, 'use client', data-not-copy, attribution, reduced-motion). Own
  chunk confirmed at build. Browser-verified desktop + mobile, full CTA→drawer→RESERVE loop.
- 💤 **P6 — Block-document tier.** Superseded by D1; revisit only if hand-authoring becomes
  the bottleneck.
- 💤 **P7 — Brand reach beyond the landing page** (reservations page, receipts, QR pass,
  emails) — see Q6.

## Open decisions

- ✅ **Q1 — Who authors a bespoke page?** ANSWERED: a developer, in this repo (D1).
- ✅ **Q2 — Is a deploy per customer change acceptable?** ANSWERED by implication in D1 —
  accepting the repo as the artefact home accepts the release ladder. Recorded explicitly
  because it is the recurring complaint this design will attract.
- ✅ **Q6 (preview) — how does a customer approve before go-live?** ANSWERED by the pipeline:
  `main` deploys to a Vercel preview, and the switch stays off until they say yes.
- **Q3 — Who owns a bespoke page after launch?** The maintenance cost is real: every engine
  change means re-checking N shells. P2 (one supported booking component) plus a per-module
  smoke test is the mitigation; whether that is *enough* is a question for the second customer.
- **Q4 — How many bespoke customers in 12 months?** No longer decides the architecture, but it
  decides when P5 stops being dead.
- **Q5 — A `customBrandEnabled` boolean, not a `brandMode` enum.** With D1 the middle tiers do
  not exist, and a four-value column where two values are unimplemented is a lie in the schema.
  Boolean now; widen deliberately if P5 ever revives. (Same reasoning that gave
  `partialGroupBookingEnabled` its own column rather than a `features[]` entry.)
- **Q6 — Scope boundary.** Does the brand stop at `/s/[slug]`, or reach `/s/[slug]/reservations`,
  the QR/POS pages ([[track:022]]), receipts, the QR pass and confirmation emails? A customer
  who sees their brand on the landing page and ours on the receipt will ask. Cheapest
  defensible line: landing + reservations now, transactional surfaces later.
- ✅ **Q7 — Is this partner-visible at all?** ANSWERED (D2): the tab exposes a field iff that
  field is still in effect. Tokens go read-only under a live custom page; **the slug stays
  editable**, because it is the address rather than presentation; the fallback case keeps
  everything editable.
- **Q8 (from D2) — what does the read-only panel say?** Minimum: that the site runs a custom
  brand page, plus its live URL and the slug control. Open: whether it also shows the tokens as
  disabled fields (honest but noisy), and whether it names a route for requesting changes.
- **Q9 (from D2) — does a bespoke shell own its own page metadata?** `generateMetadata` in
  `/s/[slug]/page.tsx` builds title/description from the brand fields today. If a shell
  supplies its own, `brandName`/`tagline` stop being in effect and the D2 rule makes them
  read-only. If metadata stays platform-generated, they remain in effect and must stay
  editable. Decide this when P3 defines the module contract — it is the rule applied, not a
  new rule.

## Findings (2026-08-21)

- **The root `CLAUDE.md` claim that the brand page is "client state only, not persisted" is
  stale.** `saveBrand` (`apps/partner/app/sites/[id]/site-actions.ts:442`) validates and
  persists `brandName`, `slug`, `tagline`, `bgColor`, `fgColor`, including slug uniqueness.
  Fix that line when this track touches the area.
- **Local brand data — CORRECTED 2026-08-21.** Three sites have a slug AND a `SiteBrand` row
  (`brisa-marina`, `alonso-beach`, `la-playa-digital`). An earlier note here claimed every
  colour field was null; that was wrong, and wrong in the way that matters: it was based on a
  query that selected `primary_color`/`accent_color` and never looked at `bg_color`/`fg_color`
  — the only two the page actually reads. **`bg_color` and `fg_color` are set on all three**,
  and `brisa-marina` carries a genuinely custom `#b9e1ef`, so it renders visibly branded today
  (confirmed in the browser: the drawer and sidebar paint that blue). Null across all three:
  `primary_color`, `accent_color`, `logo_url`, `bg_image_url` — none of which `SiteViewBrand`
  consumes. So a design pass has a real branded site to work against; what it lacks is a logo
  and a background image.
- **`SiteBrand` already carries more columns than the page reads** — `primary_color`,
  `accent_color`, `bg_image_url` (+ dimensions) exist in the schema and are unused by
  `SiteViewBrand`. Tier 1 is partly a matter of consuming what is already stored.
- **Per-account gating already exists** (`AccountFeatureFlag`, resolved ahead of the global
  row in `packages/data/src/flags.ts`), so there IS precedent for customer-specific behaviour
  toggled from admin — just not for a per-site multi-value mode.

## Log

- **2026-08-21 — Scoped.** Founder asked for admin-enabled custom brand UI per site, rendered
  from manually created per-site artefacts, to sell a polished experience to important
  customers. Surveyed the existing surface (branded route, `SiteBrand`, admin sites page,
  flags, Blob usage) and framed the artefact question against the constraint that decides it:
  the branded page is the booking funnel, so any artefact format that cannot mount the
  booking engine is disqualified regardless of how much design freedom it offers. Proposed a
  four-value `brandMode` with a three-tier ladder behind it, DB for documents / Blob for
  media / repo for bespoke modules, and the sequencing recommendation to build bespoke FIRST
  and extract the block vocabulary from two real customers rather than inventing it. Awaiting
  Q1/Q2/Q4 before any code.

- **2026-08-21 — D1 decided: per-site React modules in the repo.** Founder: "git is exactly
  the right place to keep the artefacts". That collapses the design — the block-document tier
  is superseded rather than deferred (its purpose was deploy-free authoring by non-developers,
  a constituency that does not exist under D1), and the four-value `brandMode` becomes a
  boolean. Design consequences worked through and recorded above: TWO gates (registry entry =
  exists, `customBrandEnabled` = live) because either alone loses something real; the registry
  keyed by **`Site.code`** rather than the partner-editable slug, which would silently orphan
  a customer's page on a rename — an unplanned second use for the identifier [[track:022]]
  minted last week; a static import map, since a template-literal dynamic import cannot be
  code-split; `_brands` underscore-prefixed so the App Router never routes it; and fall back to
  the standard page rather than an error, because a bespoke page failing must cost the customer
  their design, not their bookings. Preview turns out to be free (Vercel preview on `main`),
  which answers the old Q6. The roadmap now leads with the small shippable switch (P1) and the
  real work behind it (P2, the booking-engine seam).

- **2026-08-21 — D2 decided: the brand tab follows the effective render.** Founder: with a
  custom brand enabled and its code present, the partner brand tab should only display that
  fact. Taken as stated and generalised to the invariant above — editor iff the standard page
  is what a guest sees — because the fallback case (enabled, module missing) leaves the token
  fields genuinely in effect, and hiding the editor there would strand live controls with no
  owner. Two consequences recorded: the partner also loses slug editing while custom is live
  (the brand tab owns the public URL), and the read-only tab needs a server-side guard in
  `saveBrand`, since a hidden form still posts. **Amended within the hour**: the founder
  restored slug editing under a live custom page. Rather than carve out an exception, the rule
  was restated as *a field is exposed iff it is still in effect* — which yields the slug
  (routing reads it either way), the tokens (nothing reads them under a bespoke shell), and the
  fallback case (everything in effect) without special-casing any of them. It also surfaced Q9:
  if `generateMetadata` keeps building title/description from `brandName`, that field is still
  in effect and stays editable by the same rule. The `Site.code` keying decision is what makes
  a rename safe, so keeping the control costs nothing. The guard consequently has to be
  field-level: `saveBrand` writes slug and tokens in one call today, so rejecting the action
  wholesale would take the slug with it. The decision also pulled a shared **manifest**
  into the design: `apps/user` owns the modules, but the partner app must know one exists and
  the admin switch should report *live* vs *awaiting code*, so the list of branded site codes
  becomes a pure module in `@repo/data` with the registry test-pinned against it — the
  `unit-address` argument again, three parties that must agree about one fact.

- **2026-08-21 — D3 decided: brands live in `apps/user/brands/<name>`.** The question was
  whether `packages/brands/alcudia` would load on demand; the answer is that laziness comes
  from the import shape, not the location, so both options are equivalent on that axis and the
  choice is really about the dependency boundary. Founder chose the app, and then made the
  sharper point: a brand reaching into app internals **is a feature**. Recorded as such —
  isolation here would buy nothing against an adversary that does not exist (brand code is
  ours, reviewed, shipped in the same release) while pushing bespoke shells toward
  re-implementing what they cannot import. No eslint boundary rule either, for the same reason.
  The residue is real coupling to internals, mitigated by the per-brand smoke test and the
  booking component's contract rather than by a wall. Location settled at `apps/user/brands/`
  rather than under `app/`, so the router never walks it and the underscore-private convention
  is unnecessary; `@/*` already resolves it. Two footguns written into the plan (template-
  literal import path, barrel re-export), plus the Tailwind glob, plus a build-time check that
  the chunk-splitting is real rather than assumed.

- **2026-08-21 — P1 done.** `Site.customBrandEnabled` (additive, defaulted, migration applied
  to local + `sunbnb_test`), a sudo-gated `setCustomBrand`, and a Custom brand toggle in the
  admin sites table. Nothing reads the column, so behaviour is unchanged by construction —
  which is the point of shipping it first: the switch can be armed before the code that obeys
  it exists.
  - **The action refuses non-booleans rather than coercing them.** `'false'`, `'on'`,
    `undefined`, `null` and `1` are each truthy or falsy by accident, and coercion would flip a
    customer's storefront the wrong way while reporting success. Five cases pinned.
  - **`false` is tested as carefully as `true`.** The kill switch is half the reason this
    column exists; a disable path that silently no-ops would only be discovered while trying to
    pull a broken page.
  - Both sudo cases assert that **nothing is written**, not just that the call throws.
  - Not browser-verified: the admin app is behind a sudo login. Verified instead that the
    column reads through the regenerated Prisma client for all six local sites (default
    `false`), which is the schema↔client↔column mapping most likely to be silently wrong.
  - The generated `migration.sql` was left exactly as Prisma wrote it — `migrate dev` had
    already applied it, so adding an explanatory comment would have desynced the recorded
    checksum. The reasoning lives on the schema field instead.
  Green: admin 193u (+11), user 628u, partner 2046u, tsc + lint clean, `migrate:check` clean.

- **2026-08-21 — P2 done, browser-verified.** The funnel is one component:
  `components/booking/BookingSurface.tsx` takes `{ site, apiKey, theme? }` and owns the sticky
  sidebar, the fixed drawer, the scrim, the minimise pill, the on-mount bootstrap and the
  `ReservationView` mount. `SiteView` went 403 → 266 lines and is now honestly just the page
  around the funnel.
  - **`theme` is two colours, not `SiteViewBrand`.** The funnel does not care about a brand
    name, a tagline or a logo, and accepting the whole object would tie it to whatever that
    shape becomes. Same instinct as keeping the booking engine out of a bespoke shell: the
    narrower the contract, the fewer reasons to change it.
  - **The peek arithmetic came out as a pure module** (`app/sites/[id]/peek-height.ts`, +6
    tests). It had four branches, no test, and a phone-only failure mode — a wrong peek clips
    the date field or leaves a slab of empty panel, which no desktop check or type error would
    catch. Placed under `app/` rather than beside the component because the user app's vitest
    include is `app/**` and `store/**` only; that is the existing split (pure logic under
    `app/`, JSX under `components/`), not a new convention.
  - **Dead code removed rather than moved:** `const withHours = false` gated two Days/Hours
    `Tabs` blocks that could never render. Carrying unreachable branches into a new component
    would have been worse than deleting them.
  - **Browser-verified, and the DOM confirmed the extracted maths:** the collapsed drawer reads
    `translateY(calc(100% - 118px))` and the spacer is `134px` on Brisa Marina — 66 (sunbeds) +
    52 (both tabs), and 118 + 16 — matching `peekHeight` exactly. Branded page: the drawer and
    sidebar paint the site's `bg_color` through the new `theme` prop, no `bg-cream` fallback
    class, zero console errors.
  - **A correction fell out of that check.** The Findings note claiming every local brand
    colour was null was wrong — it came from a query that selected `primary_color`/
    `accent_color` and never looked at `bg_color`/`fg_color`, the only two the page reads.
    `brisa-marina` has a custom `#b9e1ef` and renders visibly branded. Corrected above.
  Green: user 634u (+6), tsc + lint clean.

- **2026-08-21 — P3 done. Two things I had told the founder turned out to be wrong, and both
  were caught by building rather than reasoning.**
  - **`Site.code` cannot key the registry.** Codes are minted per DATABASE, so the same venue
    carries different ones in dev, test and production; a committed registry keyed on one would
    resolve nowhere else — including the Vercel previews that run against the TEST database,
    which is exactly the "preview is free" property D1 relied on. Replaced by
    `Site.customBrandKey`: the key lives in code, each environment's row points at it, and one
    module can serve a chain of sites. D3's "keyed by `Site.code`" is superseded; the reasoning
    that rejected the SLUG still stands.
  - **The import shape alone does not code-split, in the App Router.** I had told the founder
    laziness comes from the import shape rather than the location. The location half was right;
    the shape half was not. Measured with two brands: a bare `() => import(…)` awaited in a
    server component puts every brand in `/s/[slug]`'s page chunk, and so does `next/dynamic`
    called from server code. Only a `dynamic()` reached through a CLIENT boundary
    (`BrandMount`) emits one chunk per brand — confirmed by rebuilding and finding the two
    brands in separate chunk files with the page chunk clean, then again with a single brand.
    A source-check test now guards it, because nothing else can see it.
  - **Q9 answered in passing:** the shell owns layout and copy, not metadata. `generateMetadata`
    still builds title/description from `brandName`/`tagline`, so by D2's rule those fields stay
    editable in the partner tab. Convenient rather than clever — a bespoke page still wants a
    sensible OG card, and leaving that with the platform means one less thing per shell.
  - The admin select validates against the manifest rather than accepting free text: a typo
    stored is indistinguishable from a deleted module (both `unknown-key`, both quietly serving
    the standard page), and the person who made the typo is the least likely to notice.
  Green: user 642u, data 486u, admin 202u, tsc + lint clean, `next build` clean.

- **2026-08-21 — P4 done.** The brand tab now follows the effective render, and the split that
  D2 predicted turned out to be exactly the right shape.
  - **`saveSlug` exists because the guard has to be field-level.** `saveBrand` wrote the slug
    and the tokens in one call, so "reject while a bespoke page is live" would have taken the
    address down with the appearance. Both share one `validateSlug`, so they cannot disagree
    about what a valid public URL is, and `saveSlug` is registered in the gated-action registry
    — the coverage-contract meta-guard caught it as an unregistered action within a minute of
    it existing, which is the guard working as designed.
  - **The rule is asserted where it must NOT fire, not only where it must.** A site switched on
    with no module, or with a module but the switch off, still renders the STANDARD page, so its
    tokens are genuinely in effect and the partner keeps control of them. That half is the one a
    naive `if (customBrandEnabled) reject` would get wrong.
  - **Found while checking what the founder would see: the Business-plan gate swallowed the new
    panel.** Brisa Marina's partner is on STARTER, so the brand tab returned the "upgrade for a
    branded booking page" upsell before reaching any of this — to the owner of a site that
    already has a bespoke page, and it would have hidden the slug control D2 says stays theirs
    whatever the plan. The gate is now skipped for a bespoke site: platform-delivered work is
    not a plan entitlement.
  - **Removed a false user-facing claim**: the brand tab carried an amber banner reading
    "Brand customization is coming soon. Changes made here are preview only and won't be
    saved." `saveBrand` has been persisting all along. The matching stale line in the root
    `CLAUDE.md` is gone too.
  - The panel copy is a first draft and user-facing, so it wants a founder review before
    promote (`.claude/rules/deploys.md`).
  Green: partner 2056u, tsc + lint clean.

- **2026-08-21 — P5 done: the Alcúdia page, browser-verified end to end.** Design thesis:
  the beach's one famous truth is shallowness, so the page is a slow wade — each section a
  step deeper (tinted panels + bathymetric contour separators with measured depths), footer
  past the sandbar; the booking panel keeps a constant pale surface, the raft you can always
  climb onto. Three type voices with one job each (Bricolage = the shout, Source Serif = the
  holiday prose, Spline Mono = the measuring voice: depths, hours, counts, codes). Notes:
  - **Copy is data where it can be**: price, bed/parasol counts, hours and availability all
    come from the payload, and the smoke test REJECTS a literal euro amount in source — the
    tariff can rise without the page lying.
  - **The CC BY photo credit found its home** — the earlier caveat that nothing renders a
    photo credit is resolved by the brand footer.
  - **An engine bug surfaced immediately**: the map opened on the seats' bounding-box centre,
    which on a 2.8 km curved bay is open water at zoom 20 with every seat culled. Fixed in the
    engine (`inventoryAnchor`: nearest real seat to the centre), tested with a crescent
    inventory, benefits every site. First proof of the D3 bet: building a real brand page
    against real inventory finds engine defects a compact demo site never would.
  - **Both real brands confirmed as separate chunks** at build; the page chunk stays clean.
  - Local demo wiring: Alcúdia is live (`customBrandKey: 'alcudia'`, enabled); Brisa Marina
    reverted to the standard branded page.
  Green: user 652u (+8 incl. 4 anchor + 6 brand-kit − reshuffles), data 486u, admin 202u,
  partner 2056u, tsc + lint clean, `next build` clean.

## Links

- [[track:022]] — short QR URLs; Q6's scope question overlaps (the QR/POS pages are another
  guest-facing surface a branded customer will expect to carry their brand).
- [[subsystem:design-system]] — the design language a bespoke shell should build ON, not
  around; `/ui user` primes it.
- [[entity:reservation]] — the funnel the branded page must keep intact.
