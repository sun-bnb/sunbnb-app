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

- **Next action:** **Awaiting go-ahead.** Start **P1** — add `findReservations(siteId, query?,
  accessKey?)` to `apps/partner/app/sites/[id]/manage/actions.ts` (token-or-session gated), register it
  in `app/test/gated-actions.ts`, and cover it (unit gate + query shape; integration: arrivals +
  name/phone matches incl. a future booking). Prime `/ui partner`.
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

- ☐ **P1 — Backend: `findReservations` (data + gate).** `findReservations(siteId, query?, accessKey?)`,
  token-or-session: **no query** → today's `expected` + `held` (the Arrivals list); **query** →
  `guestName` / `guestContact` (case-insensitive `contains`) across `[startOfToday, +N days]`, capped
  and date-sorted, each row carrying bed number(s) + status + period. Register in `gated-actions.ts`
  (auth-matrix + coverage-contract stay green). Unit: gate + the query keys on `siteId` and is
  ownership-scoped, no cross-site leak. Integration (`sunbnb_test`): returns today's expected/held;
  name + phone match; **surfaces a future-dated booking** not on today's grid.
- ☐ **P2 — UI: the Guests sheet.** `GuestSearchSheet.tsx` bottom sheet (mirrors `TillSheet` chrome,
  dark-mode aware): search field + Arrivals default + results; context-aware row actions — today
  expected → **Locate** / **Check in**; today hold → **Locate** / **Rent**; today walk-in/checked-in →
  **Locate**; future → **Details** (read-only). **Entry = a bottom-right anchor FAB** (🔍 search icon,
  **always present**), with the conditional rentals/parcels toggle stacking **above** it (the anchor is
  Guests because it's always relevant — see Log 2026-06-19); all three manage FABs (worker bottom-left,
  Guests + rentals bottom-right) hidden during multiselect, like the existing two. `view.tsx`: sheet
  state + **Locate** handoff (jump to the bed's parcel + open `BedDetail`, reusing the existing
  selection), inline `checkInReservation` / `convertHoldToWalkIn`. `Guests` i18n in en/es/fi.
- ☐ **P3 — Arrivals roster enrichment (host-stand layer).** Rows carry party size (+N), **paid-vs-hold**
  chip, **notes** (VIP/allergy), and a **not-arrived / unfulfilled** state; empty / no-match / loading
  states; optional recent-search. Turns the list from "names" into a roster staff prep against.
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

## Open decisions

- **Future search window depth** — how far ahead `query` reaches (default **90 days**?).
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
