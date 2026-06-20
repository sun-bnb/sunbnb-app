---
id: 010-floor-reservation-lookup
title: Floor Reservation Lookup & Arrivals — the "Guests" host stand
status: proposed
created: 2026-06-19
updated: 2026-06-19
worktree: null
---

## Goal

Turn the token-gated partner **manage page** into a **digital host stand / arrivals board** via a
**"Guests" bottom sheet**. The **spine is reservation lookup + today's arrivals** (this is the part
that reaches parity with Alonso); the **value** is making it the *active* surface that drives the
**arrival → seat → turnover** loop, not a passive search box:

- **Default view = today's expected arrivals** — online `expected` + staff `held` reservations not
  yet checked in, as a scannable list (name · bed(s) · period · status chip), far faster than
  hunting yellow beds on the grid.
- **Name / phone search** — matches `guestName` / `guestContact`, and **reaches beyond today's grid**
  (surfaces future-dated bookings the floor can't currently see at all).
- **Hands off to what staff already know** — a row's **Locate** jumps to the bed and opens the
  existing `BedDetail`; inline **Check in** / **Rent** reuse the existing token-gated actions.

**Why it matters (verified gap).** The manage page is **today's-bed-grid-only** — its reservation
query is `from <= todayEnd && to >= todayStart`, there is **no reservation search**, and the only
search (`searchAllReservations`) is **owner-session-gated** (`app/frontdesk/actions.ts`). So a beach
employee holding only a manage access key **cannot** answer "is there a booking under García?", find a
booking by phone, or handle a guest whose booking isn't on today's grid (future-dated / early arrival).
They are great at *acting* on today's grid and blind to everything else.

**The Alonso angle (why THIS and not the richer flows).** Reservation lookup is the **single
reservation capability where Alonso's *floor* genuinely beats Sunbnb's floor**: Alonso always shows a
standing *Reservas* list by client name (+ auto-created "Reserva Rápida" rows). This sheet reaches that
parity and **surpasses** it (phone search, real dates, paid-vs-hold status, future bookings, lifecycle
handoff) because Sunbnb has the richer substrate. Everything *more* (extend-stay, non-today
cancel/refund) is **post-Alonso** — Alonso's dateless, money-less reservation model can't even express
those — so they are deferred to their own tracks (see Roadmap → Deferred), not folded in here.

**Read-only by design.** Lookup mutates nothing; the inline Check-in/Rent/Release are existing floor
actions. So it adds **no new access-key blast radius** — a deliberate contrast with the deferred
non-today cancel/refund (which *would* widen what a leaked manage token can do, and so needs guarding).

**Beyond Alonso — the host-stand layer (what makes it *really* useful).** Alonso's *Reservas* is a
passive name-on-beds book; Sunbnb has dates, payment, lifecycle, notes, staff attribution, **and a
scannable pass per booking**, so the same surface can be the *active* host stand. Three differentiated
drivers (each leans on data Alonso doesn't have):

- **Scan the guest's pass → instant check-in.** Every booking already issues a QR ticket
  (`apps/user/app/reservations/[id]/pass`). The strongest entry isn't typing "García" (spelling,
  shared names, language) — it's **scan the confirmation QR → that booking opens → check in.** Zero
  ambiguity; name/phone search becomes the *fallback*. Squarely beyond Alonso.
- **A proactive arrivals roster, not just a lookup.** The default view carries name · bed(s) · party
  size · **paid-vs-hold** · **notes** (VIP / "always bed 1" / allergy) + a **not-arrived / unfulfilled**
  state — so staff *prep* in the morning, greet by name, and route food/messages. A CRM-lite the bed
  grid (just yellow) can't be.
- **Turnover → revenue.** The roster surfaces **unfulfilled holds/bookings** (still `expected`, never
  checked in) so staff **release and resell** dead beds on a sold-out day — a real revenue lever
  (€40–50/bed), via the *existing* token-gated release/no-show actions (no new mutation surface).
  Alonso has no "did they show?" signal at all.

*(Honest caveat: sunbed bookings are **day-scoped, not timed**, so this is a "who's expected today"
roster, not a minute-by-minute schedule — the timed version applies to tables/rentals.)*

## Resume here

- **P1+P2 SHIPPED & LIVE on test+prod (deployed 2026-06-20).** Committed `06a0224` (P1) + `e7952fd`
  (P2); `main`→test→production all at `e7952fd`. No schema change, so no migration was owed. The
  floor-lookup gap vs Alonso is now closed end-to-end in production. Phase detail below.
- **P1 DONE (2026-06-19, committed `06a0224`).** `findReservations(siteId, query?, accessKey?)` in
  `manage/actions.ts` (token-or-session): no query → today's `expected` complete+held arrivals; query →
  `guestName`/`guestContact`/`user.email`/`user.name` case-insensitive `contains` across `[today, +90d]`
  (canceled/refunded excluded, capped 50, date-sorted), returning `ReservationMatch` rows (party size +
  bed numbers + paid-vs-hold + notes + account email). Registered in `gated-actions.ts` (auth-matrix
  481, coverage-contract green). 5 unit (gate + query shape + row mapping) + 4 integration (arrivals
  excl. seated walk-ins; case-insensitive name; **future booking surfaced**; canceled excluded). partner
  1489 unit + 43 manage integration, tsc/lint clean. No schema change.
- **P2 DONE (2026-06-19, committed `e7952fd`).** `GuestSearchSheet.tsx` (bottom sheet over `findReservations`:
  arrivals default + debounced name/phone search, status chips paid/hold/seated/upcoming, party size +
  bed labels + notes, context actions Locate/Check-in/Rent, future = read-only). Wired into `view.tsx`:
  a bottom-right **🔍 anchor FAB** (always present off-multiselect) with the rentals toggle bumped to
  `bottom-24` above it; `locateReservation` jumps to the bed's parcel + opens `BedDetail`; inline
  `checkInReservation` / `convertHoldToWalkIn` refetch + `router.refresh()`. `SiteManage.guests` +
  `Guests` i18n in en/es/fi. tsc/lint clean; partner 1489 unit green (UI — no new unit tests; the
  action is covered by P1). `ReservationMatch` exported from the 'use server' actions file (precedent:
  `orders/actions.ts`, `restaurants/[id]/queries.ts`); client sheet only imports pure `reservation-
  status` constants (no prisma in the bundle).
- **Next action:** **VALIDATE before building more.** The P3 *correctness* slice shipped (`80bacc5`);
  the rest of P3 (roster CRM decoration) + P4 (scan-the-pass) + P5 (resell) are **parked as
  unvalidated demand** (2026-06-20 decision — they're Alonso-model hypotheses, not operator requests).
  The cheapest real next move is to **instrument the hypotheses**, not build them: are guests opening
  `/reservations/[id]/pass` (→ informs P4)? how often does a held bed end the day `expected` and never
  checked in (→ informs P5)? Build a phase only once a signal — or an operator ask — pulls it. If/when
  building resumes, prime `/ui partner`.
- **Context needed:** the manage page is **token-gated** (`accessKey`/`SecurityToken` via
  `verifySiteAccess`, no session) and renders a **today-overlap** grid (`page.tsx`). Reference query:
  `app/frontdesk/actions.ts#searchAllReservations` (owner-only) — bring it to the token-gated floor,
  **scoped to the one site**. Reuse: `BedDetail` (Locate handoff), `checkInReservation` /
  `convertHoldToWalkIn` (inline actions), and the bottom-sheet pattern from `TillSheet.tsx` /
  `CollectPaymentModal.tsx`. Entry = a **bottom-right anchor FAB** (`ManageWorkerFab` is the pattern
  to mirror; the rentals toggle in `view.tsx` stacks above it). Reservation fields all
  exist: `guestName`, `guestContact`, `from`/`to`, `operationalStatus`, `status`, `items`. **No schema
  change.** No new gate type — `token-or-session` like the rest of `manage/actions.ts`.
- **Blocked by:** nothing.

## Roadmap

- ✅ **P1 — Backend: `findReservations` (data + gate). DONE 2026-06-19 (uncommitted).**
  `findReservations(siteId, query?, accessKey?)`, token-or-session: no query → today's `expected`
  complete+held arrivals; query → `guestName`/`guestContact`/`user.email`/`user.name` case-insensitive
  `contains` across `[today, +90d]` (canceled/refunded excluded, capped 50, date-sorted), returning
  `ReservationMatch` rows (party size + bed numbers + paid-vs-hold + notes + email). Registered in
  `gated-actions.ts` (auth-matrix 481, coverage-contract green). 5 unit + 4 integration (incl. a
  future-dated booking surfaced by search). partner 1489 unit + 43 integration, tsc/lint clean. No
  schema change. **Accent-insensitive search (García vs garcia) noted as a future refinement** —
  needs the Postgres `unaccent` extension; P1 is plain case-insensitive `contains`.
- ✅ **P2 — UI: the Guests sheet. DONE 2026-06-19 (uncommitted).** `GuestSearchSheet.tsx` bottom sheet (mirrors `TillSheet` chrome,
  dark-mode aware): search field + Arrivals default + results; context-aware row actions — today
  expected → **Locate** / **Check in**; today hold → **Locate** / **Rent**; today walk-in/checked-in →
  **Locate**; future → **Details** (read-only). **Entry = a bottom-right anchor FAB** (🔍 search icon,
  **always present**), with the conditional rentals/parcels toggle stacking **above** it (the anchor is
  Guests because it's always relevant — see Log 2026-06-19); all three manage FABs (worker bottom-left,
  Guests + rentals bottom-right) hidden during multiselect, like the existing two. `view.tsx`: sheet
  state + **Locate** handoff (jump to the bed's parcel + open `BedDetail`, reusing the existing
  selection), inline `checkInReservation` / `convertHoldToWalkIn`. `Guests` i18n in en/es/fi.
- ◐ **P3 — Arrivals roster enrichment (host-stand layer). CORRECTNESS SLICE DONE (`80bacc5`, 2026-06-20);
  the rest PARKED pending operator signal.** ✅ Shipped: distinct **error state** + Retry (was: error
  return coerced to `[]`, so a failed fetch looked identical to "no arrivals"), `aria-busy`/`role=status`
  a11y, and stale-dimming on re-search instead of blanking to "loading". 💤 Parked (speculative
  decoration, not built): party-size/paid-hold/notes chips as a CRM roster + the **not-arrived /
  unfulfilled** treatment. **Decision (2026-06-20):** these are hypotheses reasoned from the Alonso model,
  not requests from real Sunbnb operators — building them risks spending usability budget (already 3 FABs
  on the manage screen) on unvalidated demand. Validate first (do operators want it? is there a pain
  signal?) before building. See Log.
- ☐ **P4 — Scan-the-pass entry.** A "Scan pass" affordance on the sheet: device camera → read the
  guest's confirmation QR (`/reservations/[id]/pass`) → resolve the reservation (id / anonId) → open it
  → check in. Error-proof, beyond Alonso; name/phone search stays the fallback. (Needs a QR-scan path +
  camera permission — see Open decisions.)
- ☐ **P5 — Resell-the-no-shows nudge.** Surface today's **unfulfilled** holds/bookings (still `expected`,
  never checked in) as a distinct group so staff can **release and resell** dead beds — wired to the
  *existing* token-gated `releaseHold` / `markNoShow` / `unreserveItem`, so no new mutation surface.
  v1 = passive (surface + one-tap release); an active "free N beds?" prompt is a later option.
- 💤 **Deferred — separate post-Alonso tracks (NOT lookup, NOT Alonso parity).** These are Sunbnb-model
  obligations born of real dates + online prepayment, which Alonso's model can't express:
  - **Extend / shorten a present guest's stay** (change `to` → re-availability check + price delta).
    Cheap, frequent, low-risk; the strongest standalone follow-up.
  - **Guarded non-today cancel + refund** (the "arrive, cancel, refund me" case for a booking not on
    today's grid). Real, but **widens the access-key blast radius** (search-and-refund the future) →
    needs explicit confirm + audit, possibly owner-session-only for the refund. Do NOT fold into this
    read-only lookup track.
  - **Guest communication** (SMS/email about a booking). Adjacent, separate.

## Log

- **2026-06-19** — Track scoped off the reservation-handling discussion (manage page is today-grid-only,
  no search; only `searchAllReservations` exists and it's owner-session-gated). Alonso comparison
  established that reservation lookup is the *one* reservation capability where Alonso's floor beats
  Sunbnb's, and that the richer flows (extend-stay, non-today refund) are post-Alonso and deferred.
- **2026-06-19** — **Entry-point decided: bottom-right anchor FAB.** Considered a `ManageToolbar` 🔍
  icon vs a FAB. Chose a FAB — lookup is a frequent, always-relevant floor action and the bottom corner
  is far more thumb-reachable on a phone than the (already crowded) top toolbar; it also matches the
  page's existing floating-action language. The user proposed stacking it *above* the rentals FAB;
  refined to the **inverse**: **Guests is the always-present anchor at `bottom-6 right-6`, and the
  conditional rentals/parcels toggle stacks above it.** Rationale: (a) the rentals FAB is conditional
  (rentals + ≥1 parcel) — anchoring on the always-present control avoids fragile "position depends on
  another FAB's visibility" logic and empty-space-below; (b) lookup is the more-frequent, always-on
  action, so it earns the prime slot. Trade-off accepted: the shipped rentals FAB moves up one slot
  (minor one-time relearn, same corner). Guards: icon-only, consistent sizing, all three FABs (worker
  bottom-left; Guests + rentals bottom-right) hidden during multiselect; 🔍 search glyph so Guests reads
  distinctly from the worker *person*-icon FAB. Fallback if three FABs feel heavy in practice: demote
  Guests to a toolbar 🔍.
- **2026-06-19** — **Vision expanded: from lookup to a host stand / arrivals board.** Beyond the search
  spine (P1–P2), folded in three differentiated "really useful" drivers (P3–P5): (1) **scan-the-pass**
  check-in — leverages the existing `/reservations/[id]/pass` QR; error-proof vs typing names, so name/
  phone search becomes the *fallback*; (2) a **proactive arrivals roster** with notes / paid-vs-hold /
  party size / unfulfilled state (CRM-lite — prep + greet by name + route service); (3) **resell
  unfulfilled holds** as a turnover/revenue lever, via the *existing* release/no-show actions (no new
  mutation surface). Honesty caveat recorded: sunbed bookings are **day-scoped, not timed**, so it's a
  "today's expected" roster, not a timed schedule (timed applies to tables/rentals). The lookup remains
  the Alonso-parity spine; the host-stand layer is the surpass.

- **2026-06-19** — **P1 built** (`findReservations`, the backend). No-query arrivals + name/contact/
  email/account-name search across `[today, +90d]`, token-or-session, read-only, no schema change.
  Surfaced a real i18n gotcha: plain `contains mode:'insensitive'` is case-insensitive but **accent-
  sensitive** — "garcia" won't match "García" (the í), though "garc" does. Accepted for P1 (tests use
  non-accented names); accent-insensitive search (Postgres `unaccent`) is a noted future refinement.
  Search-window default set to **90 days**, result cap **50** (resolves one open decision).
- **2026-06-19** — **P2 built** (the Guests sheet UI). `GuestSearchSheet` over `findReservations`
  (arrivals default + debounced search, chips, party/notes, Locate/Check-in/Rent). FAB decision shipped
  as designed: **🔍 anchor at `bottom-6 right-6`**, rentals toggle bumped to `bottom-24` above it.
  Locate handoff resolves the bed in `inventoryItems` → switches parcel → opens `BedDetail` (the
  surface staff know). The floor-lookup gap vs Alonso is now **closed end-to-end** (a token-gated
  employee can find a booking by name/phone, see today's arrivals, and act — none of which the
  today-only grid allowed). P3–P5 (richer roster, scan-the-pass, resell) are the *surpass*.
- **2026-06-20** — **Surpass layer PAUSED — validate before building.** On reviewing P3–P5, the call was
  that these are *hypothetically* useful (reasoned from the Alonso competitor model), not features real
  Sunbnb operators have asked for — and each adds a surface/chip/mode every operator pays for so a
  hypothetical one benefits (the manage screen already carries 3 FABs). The parity layer (P1–P2) closed
  an *observed* gap vs a real competitor and is the known-valuable part; the surpass layer is demand-side
  hypothesis. **Decision:** ship only the P3 *correctness* slice (error/empty/loading/a11y robustness —
  not a feature, just finishing P2 properly; `80bacc5`) and **park** the roster-CRM decoration + P4 + P5
  until a signal pulls them — an operator request, or instrumentation showing the pain (pass-QR usage for
  P4, unfulfilled-hold rate for P5). Resist building the floor's features on the floor's behalf.

## Open decisions

- ~~**Future search window depth**~~ — resolved P1: **90 days**, cap 50.
- **Accent-insensitive search** — "García"/"José" vs "garcia"/"jose". Needs the Postgres `unaccent`
  extension (+ `unaccent()` in the query or a generated column). Real for Spanish/Finnish names; a
  follow-up, not P1.
- **Default view scope** — Arrivals only (today), or also a small near-future "Upcoming" section in the
  no-query state? (Lean Arrivals-only; future via search.)
- **Locate handoff** — jump-to-parcel + open `BedDetail` (recommended, reuses everything) vs an inline
  row expansion.
- **Contact search privacy** — matching `guestContact`/phone on the token-gated floor (staff already
  see `guestName` in `BedDetail`, so consistent; confirm the posture).
- **Scan-the-pass mechanics (P4)** — device-camera QR scan (a scanner lib + camera permission on the
  token-gated page) vs manual code entry; what the pass QR encodes and how the floor resolves it to a
  reservation (reservation id / `anonId` / a signed token) without a session.
- **Resell nudge scope (P5)** — passive (surface unfulfilled rows + the existing one-tap release) vs an
  active prompt ("3 holds unfulfilled — free 5 beds?"). Lean passive for v1.

## Links

- [[track:006-alonso-staff-ui]] — the manage UI this extends (bed grid, `BedDetail`, lifecycle actions).
- [[track:008-employee-model]] — bottom-sheet / FAB / token-gated patterns to mirror (`TillSheet`,
  `ManageWorkerFab`, `getTillStatus` gating).
- [[track:005-alonso-beach-model]] — design source; `.claude/alonso/model/reservations-and-rentals.md`
  (the *Reservas* list this reaches parity with; Alonso reservations are dateless, money-less,
  edit-less — context for why the richer flows are deferred, not copied).
- Reference impls: `apps/partner/app/frontdesk/actions.ts#searchAllReservations` (owner-only search to
  port to the token floor); `apps/partner/app/sites/[id]/manage/page.tsx` (today-only grid query);
  `apps/partner/app/sites/[id]/manage/{TillSheet,CollectPaymentModal,BedDetail}.tsx`;
  `apps/user/app/reservations/[id]/pass` (the QR ticket pass the **scan-the-pass** entry reads).
- Rules: `.claude/rules/{ui,data-access,auth}.md`; UI: `/ui partner`.
