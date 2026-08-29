---
id: 024-card-present-payments
title: Card-present payments — Viva as the card rail, and the floor app that hosts it
status: active
created: 2026-08-28
updated: 2026-08-29
worktree: null
---

## Goal

Let a venue take a **card payment at the lounger** — today the floor can only take cash
(`recordSettlement` → till) or show a Mollie QR the guest pays on their *own* phone. Neither
covers the ordinary case: a guest standing at the parasol holding a card, with no phone out.

End state: staff tap "Collect", the guest taps a card against the staff device, the
reservation settles through the same state machine, till, and invoicing as every other
payment — and the platform still gets paid its commission.

Strategic end state (later, gated on the first working): **one payment provider** for both
rails — card-present on the beach and the online booking funnel — instead of Mollie for
online plus a second acquirer for card.

## The decision (2026-08-28, founder)

1. **Viva.com is the payment provider direction.**
2. **React Native, portable across iOS and Android**, hosting floor management then orders.
   **REVISED 2026-08-29: it lives in THIS monorepo at `apps/mobile`, not a separate repo** — the
   original own-repo/copy-to-sync plan is withdrawn. Rationale (founder): it shares the context.
   Consequence: `@repo/data`'s client-safe modules and the extracted pure logic are **imported, not
   copied**, so they stay inside the single-writer ratchet and the auth matrix, and the sync problem
   the copy plan created simply does not exist. Screens are still reimplemented — RN does not render
   DOM. Context boundary created at `apps/mobile/CLAUDE.md`; the RN scaffold and workspace wiring
   land at P7 (no `package.json` yet, so the lockfile is untouched).
3. **Near term: keep Mollie for online payments. Viva for card only.**
4. **Later: replace Mollie with Viva if the card rail proves out.**

### Why Viva and not SumUp

The comparison was run on card-present only at first, and on that narrow question **SumUp
wins**: 1,49% flat in Spain (vs Viva 1,69% EEA personal cards), and — decisively for a
web-first rollout — SumUp's URL scheme is launchable from Chrome with an `https://` callback,
so card acceptance ships with *zero native code*. Viva's app-to-app is Android Intents with a
custom-URI callback, which assumes a native caller.

The question that flipped it: **does either cover the online payments Mollie collects today?**

| | Marketplace / split payments | Sub-merchant onboarding | Card-present |
|---|---|---|---|
| Mollie (today) | yes — Mollie for Platforms, `applicationFee` | yes, via OAuth from partner app | Tap to Pay exists, **not in Spain** |
| SumUp | **no** — single-merchant only | no | yes, 1,49%, browser-launchable |
| Viva | **yes** — real-time split, commission to marketplace account | yes — eKYB via ISV APIs | yes, 1,69%, app-to-app |

SumUp has online payments but no connected-merchant or split-payment product. It can
therefore **only ever be a second, card-present-only rail** — permanent two-acquirer friction
per venue (two dashboards, two payout schedules, two reconciliation streams, PARTNER invoices
on two rails), and a sales objection at every deal: *"I already have Mollie, why do I need
SumUp too?"*

Viva is a licensed bank and e-money institution with a marketplace product matching the agent
model this platform already runs on — the same shape that [[track:003]] exists to satisfy.
Choosing Viva buys a **single-provider end state**; choosing SumUp forecloses it.

**Accepted trade:** 0,20 pp worse on card-present rates, and a harder card-present integration,
in exchange for the option to consolidate. The rate gap is the smaller number — two acquirer
relationships is a permanent per-venue tax.

## The finding that qualifies the plan — READ BEFORE BUILDING THE APP

**Viva has no embeddable Tap-on-Phone SDK — CONFIRMED 2026-08-28.** Their model is app-to-app
against the separate **"Viva.com Terminal"** application on *both* platforms: Android intents,
and on iOS a URL scheme plus `application(_:open:options:)` on the client app's AppDelegate. The
SDKs on their developer portal are **device-specific hardware SDKs** (Ciontek CS30 / CS50C —
thermal printer access on Viva's own terminal hardware), not a softPOS SDK. There is no way to
run a Viva card payment inside your own UI.

**SumUp does have one, on both platforms — CONFIRMED 2026-08-28.** An Android Tap-to-Pay SDK and
an iOS SDK whose Reader SDKs embed in-person acceptance directly in a third-party app, using Tap
to Pay on the device itself (iPhone XS+, and Spain is a supported market). Caveat to verify: the
docs also say the free SumUp Business app must be installed to use Tap to Pay — if that holds for
the SDK path too, the gap between the two vendors narrows somewhat, though the transaction itself
still runs inside your app.

This matters because **"stay inside our own UI" was the main stated rationale for building the
native app**. With Viva, even native, the payment leaves Sunbnb and renders in Viva's Terminal
app. What softens it: Viva documents four operating modes, including **Semi-Unattended**
(auto-dismissable dialogs that return focus to the caller) and **ECR-Controlled** (third-party
apps apply Terminal controls). That likely turns the switch from a visible manual round-trip
into a brief automatic one — but it is still an app switch, not an in-app SDK.

Consequences to hold in mind:

- The native app's *payment* rationale is weak on Viva. Its **other** rationales are unaffected
  and remain strong: pairing instead of an access-key-in-a-URL, push, offline tolerance on beach
  signal, home-screen presence, camera for QR.
- **Viva card acceptance may not require the native app at all.** Their **Cloud Terminal API**
  (server pushes a payment request to the paired device running Viva Terminal) is web-friendly —
  the "Option 1" architecture. That could ship card payments from the *existing web app* this
  season, with the native app decided separately on its own merits.
- Under PCI MPoC the tap prompt and PIN pad are provider-drawn and unstylable **on every
  provider**. Full brand control of the payment moment was never available from anyone.
- **Effect on the React Native decision, per vendor:** Viva's app-to-app shape means the app only
  launches a URL scheme / intent and handles a callback — trivial on both platforms, **almost no
  native bridging**, and the shape is identical on iOS and Android. The SumUp SDK route inverts this:
  no first-party RN wrapper was found, so it means writing and maintaining a **native module per
  platform**, plus Apple's Tap to Pay on iPhone entitlement. In-app UI is bought with native work.

### Android viability — confirmed 2026-08-29 (the platform is not in doubt)

The `viva.com Terminal` app (`com.vivawallet.spoc.payapp`) is on Google Play with **~2.2M
downloads**, requires only **Android 8.1+ with NFC** ("any device from the market"), and works
across **all 24 European countries** Viva operates in, Spain included. It accepts Visa, Mastercard,
Maestro, Diners, Discover, AMEX and Apple/Google/Samsung Pay. Android is Viva's *broader* platform —
Tap to Pay on **iPhone** came later and carries an explicit country list (Spain added 2025-07).
The 8.1 floor is also more permissive than SumUp's Android 11+, which matters when staff bring
whatever phone they own. Play Integrity attestation still applies on top, so rooted devices and
emulators are excluded regardless of the stated minimum.

**Consequence of app-to-app worth holding:** the Terminal app *is* our payment UI, so its quality is
our problem in a way an embedded SDK's would not be. Play Store reviews are mixed — recurring reports
of Bluetooth pairing trouble and card-limit handling. Evaluate the app itself during the P0 demo
spike, not just the API.

### The trade, stated plainly

|  | Payment inside the Sunbnb UI | Single provider (online + card) | RN integration cost |
|---|---|---|---|
| **Viva** | ✗ — app switch, both platforms | ✓ — marketplace; could replace Mollie | low (deep links only) |
| **SumUp** | ✓ — SDK, both platforms | ✗ — no marketplace; permanent 2nd rail | higher (native module ×2) |

**No vendor offers both.** The provider choice IS this trade, and Q7 records it as reopened.

Q1 (below) must be answered before the app repo is created.

## Resume here

**Next action — W1 (seat tap → bed-detail sheet) from the P7 parity work list below.**
(Context: mockups approved 2026-08-29;
foundations all landed the same day: `@repo/floor-core`, the P6.5 HTTP surface, and the
`apps/mobile` scaffold with a live beds-grid v0). Order: bed-detail sheet (all 13 branches,
per the design-pass inventory) + the collect flow (QR/cash through the RPC collect triple) →
multiselect + move mode → rentals / guests / today tabs → QR-camera pairing (expo-camera).
To run: partner locally (`cd apps/partner && source .env.local && npm run dev`; also serves
plain HTTP :3011 for simulators/phones), then `cd apps/mobile && EXPO_PUBLIC_API_URL=http://localhost:3011 npm start`,
pair by pasting a manage URL. The Viva ISV conversation is **still open and gates only the
payment leg (W8/P2–P4)** — wire "Tap card" behind a flag when answered. Its unknowns:)

1. **Tap-on-Phone UI model** — can a payment render inside a third-party Android app, or does it
   always hand off to Viva.com Terminal? If hand-off only: what exactly do Semi-Unattended and
   ECR-Controlled modes change about what the operator and guest see?
2. **Spain commercials for an ISV** — Tap-on-Phone availability and rates under the ISV partner
   program (published 1,69% is the direct-merchant rate); marketplace/sub-merchant terms and
   commission mechanics for the later Mollie replacement.
3. **ISV markup mechanics** — confirm the markup applies to Tap-on-Phone card-present transactions
   (cash is documented as excluded, implying card is in), the monthly-credit settlement shape, and
   whether marketplace real-time split also covers POS. See Q2.
4. **Cloud Terminal API viability** — can it target a Tap-on-Phone device (not just hardware
   terminals)? If yes, card payments ship from the existing web app and the native app decouples
   from this track entirely.

**Context a cold agent needs:** this file's *Decision* and *Finding* sections; the collect seam
at `apps/partner/app/sites/[id]/manage/CollectPaymentModal.tsx:24` (`CollectActions` triple) and
`.../manage/actions.ts:1981` (`collectReservationPayment`); the machine cell at
`packages/data/src/reservation-machine.ts:277` (`collect.start`); the Mollie precedent for
per-partner OAuth at `packages/data/prisma/schema.prisma:188`.

**Blocked by:** nothing technical. Every phase below is gated on Q1/Q2 answers, not on code.

## Roadmap

- ☐ **P0 — Provider due diligence** (the Resume-here conversation). Answers Q1, Q2, Q5. Deliverable:
  a decision on whether card ships web-first (Cloud Terminal API) or waits for the native app.
- ☐ **P1 — Viva merchant connect.** `vivaAccessToken`/`vivaRefreshToken`/expiry + onboarding status
  on `PartnerAccount`, mirroring the four `mollie*` columns (`schema.prisma:188`) and the
  `/api/onboarding-status` route. Additive migration. Partner-app connect flow next to the Mollie one.
- ☐ **P2 — The collect transition.** New effect key on `collect.start` (`reservation-machine.ts:277`)
  swapping `mollieCreate` for a card-rail equivalent; everything downstream (`pay.confirm`,
  `pay.fail`, `collect.abandon`'s never-frees-a-bed rule, till partitioning on splits) unchanged.
  **Edit the table, not the actions** — [[track:018]] doctrine.
- ☐ **P3 — Server-side verification.** The client's word on payment success is never authoritative:
  a callback query string is user-typable, so status resolves by server lookup against Viva's
  transaction API keyed on our own client-transaction id. Mirrors the existing webhook-vs-poll
  doctrine; `getCollectStatus` keeps its meaning.
- ☐ **P4 — Refunds.** `issueRefund` / `getPaymentStatus` (`apps/user/app/api/_lib/payment-provider.ts`)
  gain a Viva branch. Already provider-agnostic over Mollie + demo, so this is a branch not a rewrite.
  Watch for refunds performed *in the Viva app* that the machine never hears about.
- ☐ **P5 — Floor UI: unify manage + site orders.** Wanted independent of payments. **Gotcha:**
  `apps/partner/app/restaurants/[id]/orders/page.tsx:3` imports `@/app/sites/[id]/orders/view` —
  the restaurant kitchen dashboard *is* the site orders view under a `scope` prop. Moving it breaks
  a surface explicitly out of scope; promote it to a package instead.
- ☑ **P6-lite (DONE 2026-08-29) — `@repo/floor-core`.** Floor view-model types (`Reservation`/`InventoryItem`/`ReservationDayRow`) + `bed-state` + `grid-helpers` moved out of
  the manage surface as a package (git renames, 50 tests); partner re-points, `types/shared.ts`
  re-exports. `reservation-day.ts` stays server-side (imports prisma).
- 💤 **P6 — Extract the floor app.** Pure move, no behaviour change, existing tests green.
- ☑ **P6.5 (DONE 2026-08-29) — HTTP surface for the floor actions.** Prerequisite for P7 that the RN decision creates:
  the app cannot call server actions, so the floor's gated actions need API routes (or one RPC
  endpoint) in front of them. Must preserve the `verifySiteOwnership(siteId, accessKey)` gate and stay
  inside the gated-action registry (`apps/partner/app/test/gated-actions.ts`) so the auth matrix still
  covers them — a second entry point that bypasses the matrix is the failure mode to design against.
  **Shipped:** `POST /api/manage/rpc` forwards 46 allowlisted actions (allowlist⊆gated-registry
  enforced by test; the route holds no auth — every action verifies its accessKey, so the auth
  matrix covers the RPC); `GET /api/manage/grid` via the extracted `loadManageGrid` loader shared
  with `sunbeds/page.tsx`; `GET /api/manage/context` for pairing. +20 tests; 245 integration green.
- ◐ **P7 (IN PROGRESS 2026-08-29) — React Native app** (`apps/mobile`, in-monorepo). Scaffold DONE:
  Expo SDK 57 / RN 0.86 / Expo Router, pairing (paste-link → verify via /api/manage/context →
  expo-secure-store), tab shell (Beds/Rentals/Guests/Today[admin-gated]), beds grid v0 on live
  data via `@repo/floor-core` with 30 s polling; Metro bundles clean (`expo export`), repo-wide
  lint+tests green. **Pan/pinch-zoom canvas DONE (verified in iOS Simulator + founder-confirmed):**
  `src/components/GridCanvas.tsx` ports the web transform surface (clampAxis / zoomAround /
  fit-to-view / 0.6× detail-hide) on gesture-handler + reanimated with a top-left transform origin;
  `src/lib/grid-layout.ts` ports ParcelView's column construction (pairs, group gaps, extra-seat
  columns, pool section) over `@repo/floor-core/grid-helpers`, and cell colors map from
  `getCellAppearance`'s exact class strings so the derivation stays single-source. Remaining:
  bed-detail sheet + actions, multiselect/move, toolbar (zoom buttons, reverse, dark), rentals/
  guests/today tabs, QR-camera pairing, then the Viva leg. Dev loop note: partner `server.js` now
  also serves plain HTTP on :3011 for phones/simulators that can't trust the mkcert cert. Pairing replaces the
  access-key-in-a-URL; card collect is a deep-link launch + callback, needing little or no native
  bridging while Viva stays app-to-app.
- 💤 **P8 — Mollie → Viva for online.** Only if the card rail proves out. Replaces `mollie-tokens.ts`,
  `reservation-payment.ts`, the webhook route, `getPaymentStatus`, refunds, onboarding-status and
  `applicationFee` handling — **on the live revenue path**, plus re-onboarding every venue. Would
  make [[track:003]] moot. Not a side quest; its own track when it comes.

## P7 parity work list (mobile ↔ web manage surface)

Detailed execution plan to full web parity, derived from the 2026-08-29 behaviour inventories
(grid/BedDetail/bulk in one pass; sheets/till/collect/rentals/admin in the other). Order = build
order; each block lands with its RPC wiring and a Simulator verification pass.

- ☑ **W0 — Foundations (done 2026-08-29).** Pairing, tab shell, live grid data, counters, parcel
  tabs, pan/pinch canvas with real column geometry, pool section, fit-to-view, 0.6× detail-hide.

- ☑ **W1 (DONE 2026-08-29) — Seat interaction & bed-detail sheet** (web: `BedDetail.tsx`, 13 branches)
  - W1.1 Tap-to-select on the canvas: coordinate hit-test through the transform, with the web's
    6 px pan-threshold guard so a drag never selects.
  - W1.2 Sheet chrome: slide-up bottom sheet, backdrop-close, `#seatId` header + state badge
    (Free/Reserved/Occupied/Blocked/Comp) + companion `+#n` chip, error banner, live re-resolve
    of the open seat on the 30 s refresh.
  - W1.3 Group-scope toggle (Pair/Group vs Seat; in-sync detection; visible only on `available`).
  - W1.4 OccupantInfo row: name/fallback, notes icon + tooltip, paid icon, check-in time pill,
    `{n}D` multi-day chip.
  - W1.5 Branch `available`: guest-name input, multi-day toggle + date picker (min tomorrow,
    max +90 d), Block / Comp / Reserve (hold), Walk-in (free site) or pay fork (paid site), and
    the seat-management footer (addSeatToGroup / removeGroupSeat / deletePoolSeat) + wire the
    pool "+" button (createPoolSeat).
  - W1.6 Branches `expected`: COMPLETE (check-in / mark no-show / cancel) · PAID_IN_CASH
    (resumeWalkIn / refund-or-unreserve) · HELD (name/date edit, convert to cash/card walk-in,
    release) · failed (remove) · in-flight (read-only chip).
  - W1.7 Branches present/other: checked-in (depart / cancel) · walked-in (inline Settle amount
    editor, Collect with splitWalkInSeat seat-split, depart, cancel/refund/unreserve) · blocked
    (unblock) · comp (end comp).
  - W1.8 Confirm panel (no-show / depart / unreserve with partitioned `freedSeatShare` /
    `settledTotal` amounts / remove / cancel) + the Mollie refund sub-control. The web's "Enable
    refunds" reconnect redirect needs an owner session — on mobile show guidance instead.

- ☑ **W2 (DONE 2026-08-29, W2.2's Tap-card flag pending Viva) — Collect payment (QR + cash)**
  - W2.1 CollectPaymentModal port: the CollectActions triple over RPC (create / 2.5 s poll /
    cancel), amount header, QR render (add `react-native-qrcode-svg`), demo mode, complete /
    failed / canceling states, cancel-never-frees-the-bed semantics.
  - W2.2 Method chooser per the approved mockups (Cash / QR / Tap card) — Tap card hidden behind
    a feature flag until W8.

- ☑ **W3 (DONE 2026-08-29) — Worker & till**
  - W3.1 Worker selector: roster from the grid payload, initials chip in the header, per-site
    persistence, stale-worker validation; thread `currentWorkerId` through every create/settle
    RPC argument (reserveItem(s), holdBed(s), compBed(s), blockBed(s), convertHoldToWalkIn,
    unreserveItem, settleReservation, createWalkInRental).
  - W3.2 TillSheet: getTillStatus / closeTill, carry-over banner, sweepable-total two-step
    confirm, closed state.

- ☑ **W4 (DONE 2026-08-29) — Multiselect & move**
  - W4.1 Extract the web's seatKind classification + bulk verb matrix out of `view.tsx` into
    `@repo/floor-core` (pure, tested) so web and mobile share one opinion — same doctrine that
    moved bed-state.
  - W4.2 Long-press (450 ms) multiselect, selection rings on the canvas, non-modal bulk sheet,
    tap-toggles-selection, FAB/tab suppression while selecting.
  - W4.3 Bulk verbs + execution semantics: sequential per-seat/per-reservation runners,
    all-or-nothing grouped creates, subset-aware convert/depart splits, bulkCardEligible
    one-booking card rule, partial-failure counts, selectionRefundTotal confirmations.
  - W4.4 Move mode: banner + bulk queue, destination validation (free seat, or free group of
    exactly n), moveReservationToSeats.

- ☑ **W5 (DONE 2026-08-29) — Guests tab.** findReservations search (250 ms debounce, 0 ms empty), expected-today
  default list, status-pill precedence (Upcoming/Paid/Hold/Seated), locate → switch to Beds tab,
  right parcel, open the seat's sheet.

- ☑ **W6 (DONE 2026-08-29) — Rentals tab.** Counters (out / waiting), RentalBookingCard (Give/Back, overdue,
  paid-online chip, collect via the rental triple), CreateRentalModal (cart with stock clamping,
  duration quick-picks + custom hours 1–12, cash/card/free, giant GO; card path opens the collect
  modal on the returned bookingIds).

- ☐ **W7 — Today tab (admin).** Daily summary (open-tills + day-report modes, per-employee cards
  with itemized lists and close-till), day close, trends (7d/30d/1y windows, revenue/occupancy/
  sunbeds metrics, KPI tiles, stacked channel chart via react-native-svg or victory-native,
  daily breakdown, CSV → share sheet). Venue-local `todayIso` always comes from the server —
  never the device clock.

- ☐ **W8 — Viva card-present leg** (gated on the P0 ISV call; = roadmap P1–P4). Merchant
  connect, `collect.start` card effect key, deep-link launch of viva.com Terminal +
  `sunbnbfloor://` callback + mandatory server-side verification, refunds branch; emulator
  stub-responder tests; the real NFC handset for the tap itself.

- ☐ **W9 — App shell & platform**
  - W9.1 QR-camera pairing (expo-camera), unpair/switch-site, expired-key (401) → back to pairing.
  - W9.2 Dark mode (the web manage surface has it; palette + toggle).
  - W9.3 i18n EN/ES/FI — decide the message source: the floor namespaces live in partner
    `messages/*.json`; extract to a shared package or copy deliberately.
  - W9.4 Performance at Brisa Marina scale (4k+ items): profile, memoization, possibly
    render-only-visible rows; refetch-on-foreground (AppState) on top of the 30 s poll.
  - W9.5 NativeWind adoption decision (D2 intent) once screens stabilize — or commit to
    StyleSheet + tokens and amend D2.
  - W9.6 Tests & CI: vitest for grid-layout, the api client, and the W4.1 verb matrix; mobile
    test script in turbo.
  - W9.7 EAS: link the project, dev builds + internal distribution (prerequisite for W8 device
    testing), real app icons + splash.

**Deliberate non-parity** (per the approved mockups): landing menu + floating buttons → bottom
tab bar; guests/rentals FABs → tabs; worker FAB → header chip; toolbar zoom buttons are optional
on touch (pinch is primary) — revisit after field use.

## Development & test environment (established 2026-08-29)

**The card tap cannot be tested in an emulator — two independent blockers.** Play Integrity's
`MEETS_BASIC_INTEGRITY` exists precisely to detect emulators, and softPOS apps require device
integrity (emulator / rooted / custom ROM all fail); separately, an AVD has no NFC reader that can
read an EMV card. Same on iOS: the Simulator has no NFC. **A real device is required for the payment
leg, permanently — not just for the first spike.**

**But no real money or live merchant account is needed.** Viva ships a **Terminal app DEMO** for both
platforms (Android: Play Store `com.vivawallet.spoc.payapp.demo`, Android 8.1+ with NFC; iOS via
TestFlight invite), running against a DEMO account: simulated transactions, no funds moved, real cards
usable safely, or test cards for demo payments of 30¢ and up. Setup is a demo account plus email
whitelisting / TestFlight invite. That is a genuinely workable loop.

What splits where:

| Layer | Where it can be exercised |
|---|---|
| OAuth, payment creation, **lookup by our client transaction id** (P3), webhooks | Mac only — plain HTTP against the demo API, no device |
| Our side of app-to-app: build the intent/URL, parse the callback, drive the state transition | Emulator, using a **stub responder app** that accepts the intent and immediately calls back a canned success/failure. Also the right shape for automated tests. |
| Viva Terminal app running at all; the card tap; **Semi-Unattended behaviour (Q1)** | Real allowlisted device only |

Consequence for P0: buy one cheap Android 11+ NFC handset as the permanent dev/demo device. It is
needed for beach testing regardless, so it is not a detour. Day-to-day RN UI work still happens in the
emulator/simulator — only the payment leg needs hardware.

## Log

- **2026-08-28** — Track created from a design conversation. Explored: can a consumer Android phone
  take cards (yes — softPOS/Tap to Phone; PIN-on-glass now supported with no amount cap, so the old
  amount-ceiling objection is gone); integration shapes (embedded SDK / app-to-app deep link / cloud
  push to a paired device); hardware ergonomics (EMVCo L1 terminals certify to ~4 cm read range,
  phones can drop to ~2 cm with an unmarked, model-dependent antenna — so the practical failure mode
  is *aiming*, not speed; a ~€40 Bluetooth reader is the mitigation and rides the same integration).
  Provider comparison ran SumUp-favourable on card-present alone and flipped on the marketplace
  question. **Decision recorded above.** Late finding: Viva has no embeddable Tap-on-Phone SDK,
  which undercuts the native app's payment rationale — captured as Q1 and made the gate on P7.
  Also established: payment collection is **not** confined to sunbed management
  (`restaurants/[id]/orders/actions.ts:163` `settleRestaurantTabCash`, and the site orders dashboard),
  which is why P5 unifies manage + orders rather than shipping sunbeds alone.

- **2026-08-28 (later same day)** — Founder decided **React Native** for iOS/Android portability, own
  repo, synchronised by copying from the web repo. Recorded as D1 with its real costs: RN reuses
  *logic*, not JSX or Tailwind, and **cannot call Next server actions at all** — which promotes an
  HTTP layer for the floor's ~40 gated actions from "not discussed" to a hard prerequisite (P6.5).
  Counterweight found in the same pass: because Viva is app-to-app rather than SDK-embedded, the RN
  app needs almost no native bridging, and Viva ships an iOS terminal app too — so the provider choice
  and the portability goal agree.

- **2026-08-28 (third pass)** — Verified both vendors' SDK situation rather than leaving it inferred.
  Viva confirmed app-to-app only, both platforms, no softPOS SDK (their listed SDKs are Ciontek
  terminal-hardware SDKs). SumUp confirmed to have embeddable Tap-to-Pay SDKs on Android **and** iOS
  incl. Spain. This makes "in-app UI vs single provider" a clean either/or with no vendor offering
  both — recorded as Q7, which reopens the provider decision.

- **2026-08-28 (fourth pass)** — Chased whether Viva has a Mollie-style platform fee. It does, but via
  the **ISV Partner Program** (partner-set per-transaction markup, collected by Viva, credited monthly,
  cash excluded) rather than via the marketplace split product. This substantially answers Q2 — the
  single largest open item across the whole design conversation — and removes the collection risk that
  made the B2B-invoice option unattractive. Note it is a monthly credit, not per-payment settlement.

- **2026-08-29** — **Provider decision confirmed: Viva** (Q7 resolved). Established the dev/test
  environment: emulators are permanently excluded from the payment leg by Play Integrity plus absent
  NFC, but Viva's Terminal DEMO app + demo account give simulated transactions on a real handset with
  no live merchant account and no money moved. Server-side verification (P3) is testable on the Mac
  alone; the app-to-app callback path is testable in an emulator against a stub responder.

- **2026-08-29 (later)** — **Own-repo plan withdrawn: the app lives at `apps/mobile` in this
  monorepo.** Kills the copy-and-sync strategy and its drift risk outright — shared logic becomes an
  import. Context boundary written (`apps/mobile/CLAUDE.md`, 3.5 KB) ahead of any code, deliberately
  lean: it states the scope boundary, the three hard constraints (no server actions from RN, no
  emulator for the payment leg, the payment UI is Viva's) and the share-vs-reimplement rule, and
  points at this track rather than restating it.

- **2026-08-29 (design kickoff)** — Founder redirect: mobile-app quality is priority 1, web
  reproducibility a close 2nd, no requirement to tie code to the web implementation. Framework
  re-evaluated and settled as **D2 (Expo + React Native)**; v1 scope fixed to the manage grid.
  Sequencing revised: P0 (Viva ISV call) no longer gates UI/API work, only the payment leg.
  Design pass ran: two exhaustive behaviour inventories of the manage surface (grid/BedDetail
  branches/bulk verbs/move mode, and till model/collect triple/rentals/admin pages), then phone
  mockups published for review — native IA: bottom tab bar (Beds · Rentals · Guests ·
  Today[admin-only]), worker chip in the header, a pairing screen (QR scan → secure storage)
  replacing the access-key-in-a-URL, and the collect flow gaining a **"Tap card"** method
  beside QR and cash, with an explicit server-verification step in its progress UI. Mockups:
  claude.ai artifact "Sunbnb Floor App".

- **2026-08-29 (build session)** — Mockups approved; foundations shipped, everything green
  (12 lint / 9 test turbo tasks). **(1) `@repo/floor-core`** — types + `bed-state` +
  `grid-helpers` extracted (git renames preserve blame), partner re-points, `types/shared.ts`
  re-exports; `reservation-day.ts` deliberately left server-side (imports prisma). **(2) P6.5**
  — RPC + grid + context routes (see roadmap). **(3) P7 scaffold** — Expo SDK 57 at
  `apps/mobile`, deep-link scheme `sunbnbfloor` reserved for the Viva callback; nested React 19
  beside root React 18. Gotchas: `eslint-config-expo` abandoned — it hoists to the repo root
  and collides with the workspace's eslint 8 (`ERR_PACKAGE_PATH_NOT_EXPORTED` on
  `eslint/config`), so mobile lints with `@repo/eslint-config`; a stale
  `apps/mobile/node_modules` lockfile subtree from `expo lint`'s auto-setup had to be purged
  from `package-lock.json` by hand. NativeWind deferred to the screen build (scaffold screens
  are thin StyleSheet; D2's NativeWind intent unchanged). Context docs synced (root +
  `apps/mobile/CLAUDE.md`).

- **2026-08-29 (evening, screens session)** — **W1–W4 shipped and founder-tested in the iOS
  Simulator**; four commits (extraction 4a41afe + screens f815b51 preceded by the morning's
  foundations). The bed-detail sheet carries all 13 branches with per-action pending keys; the
  collect triple runs end-to-end in demo mode (QR via react-native-qrcode-svg); worker
  attribution + the day-anchored till close work against real data; multiselect/move run on
  the NEW `@repo/floor-core/bulk` module — the web view was refactored onto it in the same
  pass, so the verb matrix is single-source (13 new tests; partner suite unchanged at 2026).
  UI polish rounds from founder review: stroke-SVG icon set replacing emoji/text glyphs,
  full-width scope toggle, centered captions/links, per-button spinners. Dev-loop gotchas
  recorded: Metro must restart after installing a new native-module dep (hot reload keeps the
  old bundle silently), and the worker chip is dev-shifted 56px left because Expo Go's
  floating dev button covers the true corner. Remaining: W5–W7 tabs, W8 Viva (gated), W9
  platform.

- **2026-08-29 (late, tabs session)** — **W5 + W6 shipped.** Guests tab: findReservations over
  RPC with the 250 ms/0 ms debounce split, status-pill precedence, and locate → Beds via a
  tiny cross-tab channel (`src/lib/locate.ts`) consumed on focus. Rentals tab: counters,
  Give/Back transitions, cash-collect on uncollected walk-ins, and the Rent Out modal
  (two-tap happy path, stock clamping, card path collects via the rental triple with NO till
  entry). Supporting refactor: grid fetch + 30 s poll moved to a shared module store
  (`src/lib/grid-store.ts`, useSyncExternalStore) feeding all tabs; rental view-model types
  moved to @repo/floor-core (partner re-exports). Remaining: W7 Today tab, W8 Viva (gated),
  W9 platform.

## Open decisions

- **Q1 — Does Viva Tap-on-Phone render inside a third-party app, or always hand off to Viva.com
  Terminal?** Gates P7. If hand-off only, the native app must be justified on pairing/push/offline
  alone, and the "our own UI" argument does not survive.
- **Q2 — Commission on card collections. LARGELY ANSWERED 2026-08-28 — via the ISV program, not the
  marketplace product.** Viva's **ISV Partner Program** lets the partner **set its own markup per
  customer transaction**; Viva collects it and **credits it to the partner's account monthly**.
  Cash transactions are explicitly excluded — a carve-out that only makes sense if in-person **card**
  transactions are included, which is exactly the near-term use. Viva also documents folding
  maintenance/installation/operational costs into the same ISV fee to avoid separate invoicing.
  **This makes "Viva for card only" coherent from day one**: commission is collected at the rail
  rather than becoming a B2B receivable, so option (a)'s collection risk disappears.

  Two distinct Viva mechanisms, two purposes — do not conflate them:
  - **ISV markup** — per-transaction fee set by us, collected by Viva, credited monthly. The answer
    for **card-present now**.
  - **Marketplace split payments** — real-time split between sellers with commission to the
    marketplace owner's Viva account. The Mollie-for-Platforms analogue for **P8, the online
    replacement**. Documentation skews e-commerce; whether real-time split covers card-present POS
    was NOT confirmed and is a P0 question — but it matters less now that the ISV markup covers card.

  Modelling differences from Mollie to carry into P1/P3, none of them blockers:
  - Mollie's `applicationFee` settles **with each payment**; the Viva ISV fee arrives as a **monthly
    credit**. The PLATFORM commission invoice can still be issued per transaction as today, but the
    cash lands monthly — a reconciliation shape the settlement system does not currently model.
  - The ISV fee is a **markup the merchant pays**, so the venue's blended rate reads *1,69% + our
    markup*. Same economics as commission, different presentation — and the blended number is what a
    venue compares against their bank's Redsys rate. Worth pricing deliberately, not by default.

  Original framing retained for reference — Unresolved through the whole design conversation and still
  the biggest open question. Today's cash path forfeits commission entirely
  (`processConfirmedTabPayment({ cash: true })` issues a PARTNER-only receipt, no PLATFORM invoice —
  [[track:015]]). Options: (a) bill it B2B as a PLATFORM invoice, the machinery exists and it is the
  model `payments.md` already describes, but collection risk moves to us; (b) accept the loss and
  watch card become the path venues prefer *because* it is cheaper for them; (c) ISV revenue share
  from Viva. **Viva's marketplace product may make this a rail-level split rather than a receivable —
  which is the whole reason Viva was chosen. Confirm in P0.**
- **D1 (DECIDED 2026-08-28) — React Native, own repo, synchronised by copying.** Chosen for iOS +
  Android portability. A Capacitor-style wrap (one codebase, no fork) was the alternative and was
  considered and set aside. Recording what the choice actually costs, so no phase is planned on a
  wrong expectation:
  - **JSX and Tailwind do not port.** RN renders `<View>`/`<Text>`, not DOM; class-based Tailwind
    needs NativeWind or a rewrite. Every screen in `manage/` (`view.tsx` 1523 lines, `BedDetail.tsx`
    1536, the sheets and modals) is a **reimplementation**, not a copy.
  - **Server actions cannot be called from RN.** They are a Next RSC-protocol feature with no public
    HTTP contract. `manage/actions.ts` is 3370 lines of them and the app can reach **none** of it
    without an HTTP layer — see P6.5. This is the largest unplanned item the RN choice introduces.
  - **What genuinely ports as-is:** the pure logic modules this repo has already extracted —
    `bed-state.ts`, `grid-helpers.ts`, `seat-selection.ts`, `pos-seat-selection.ts`,
    `reservation-day.ts`, `peek-height.ts` — plus the client-safe `@repo/data` modules
    (`reservation-machine`, `seat-label`, `site-day`, `unit-address`, `reservation-status`) and all
    the types. That prior extraction discipline is the asset that makes this affordable.
  - **Mitigation, strongly recommended: copy the UI, but consume the logic as a dependency.** The
    high-risk code is exactly the code that ports cleanly, and it is already in packages. Publishing
    `@repo/data`'s client-safe surface to the app repo (npm or git dep) keeps one copy of the state
    machine, the derive/partition rules and the seat-label contract, and keeps them inside the
    single-writer ratchet (`packages/data/src/reservation-machine-guard.test.ts`) and the 676-test
    auth matrix. Copying *those* is where a silent divergence would land in till partitioning or
    collect-abandon, where "never frees a bed" and "splits can't create money" are load-bearing.
    Copying screens is comparatively safe — UI drift is visible, logic drift is not.
- **D2 (DECIDED 2026-08-29) — Expo + React Native, confirmed after re-evaluating against
  Flutter.** The founder dropped the tie-to-web requirement (mobile quality priority 1, web
  reproducibility close 2nd), which reopened Flutter; the decisive ground is not web UI reuse but
  that the dangerous logic (reservation machine, `bed-state`, seat selection, till partitioning)
  is TypeScript already extracted as pure modules — RN **imports** them inside the single-writer
  ratchet, Flutter would fork them into Dart where drift is silent. Viva app-to-app needs
  near-zero native code in RN, so Flutter's usual bridge advantage doesn't apply here. Concrete
  stack: Expo SDK (dev builds + EAS), TypeScript, Expo Router, NativeWind, EAS Update for OTA
  fixes mid-season. Screens are designed native-first (bottom sheets, tab bar, gestures) and
  reproduce web's behaviour contract, not its layouts. **v1 scope: manage grid only** — orders
  dashboards wait for v2.
- **Q4 — Floor app scope.** Token-gated family is `manage/*` + `sites/[id]/orders` +
  `restaurants/[id]/orders`. `frontdesk` is session-gated (`frontdesk/page.tsx:2`) and stays with the
  portal. Restaurants are out of scope by decision, but share the orders view (see P5 gotcha).
- **Q5 — Does Mollie reach Spain first?** Mollie has launched Tap to Pay on Android (NL first, then
  BE/DE/AT; Spain not listed). If it lands in Spain **and** works for platform-connected merchants
  with `applicationFee` intact, it delivers single-provider consolidation with **zero migration and
  zero new onboarding** — strictly better than the Viva path, which pays for consolidation with a
  migration of the live revenue rail. Cheap to ask; ask alongside P0.
- **Q6 — Should P5–P7 split into their own track?** The floor-app unification and extraction have
  value independent of payments, and the README says one concern per track. Split when P5 starts if
  it is pulling its own weight.

- **Q7 — RESOLVED 2026-08-29: Viva, confirmed after seeing the full trade.** In-app payment UI is
  given up deliberately. Rationale: the PIN pad is provider-drawn under MPoC either way, so SumUp's
  SDK buys only the absence of an app switch (possibly a brief automatic one under Semi-Unattended);
  against that, SumUp can never consolidate the online rail, making two acquirers permanent and
  per-venue, and its SDK route costs a native module per platform in RN. Q2's ISV markup then removed
  the last thing Viva was weak on. Original framing retained below.

  Superseded framing — **in-app payment UI, or a single provider?** The 2026-08-28
  decision picked Viva for the consolidation path, before it was confirmed that Viva can *never* keep
  the payment inside our UI on either platform. If staying in-app is a hard requirement, SumUp is the
  only route and consolidation is permanently off the table — accepting Mollie + SumUp forever.
  Weigh: the PIN pad is provider-drawn under PCI MPoC **either way**, so what SumUp actually buys is
  the absence of an app switch (Viva's Semi-Unattended mode may reduce that to a brief automatic one —
  confirm in P0/Q1); against that, two acquirers is a permanent per-venue tax and a live sales
  objection. **Third path worth considering: never adopt Viva.** Use SumUp as the card rail (in-app,
  cheaper, ships sooner) and bet consolidation on Mollie's own Tap to Pay reaching Spain (Q5) — which
  would deliver a single provider with **zero migration of the live revenue rail**, the risk the Viva
  path is quietly carrying in P8.

## Links

- [[track:003]] — Stripe Connect compliance. Same marketplace/agent constraint; P8 would make it moot.
- [[track:018]] — Reservation state machine. P2 edits its table; `collect.start`/`pay.confirm`/
  `pay.fail`/`collect.abandon` are the cells this rides on.
- [[track:013]] · [[track:015]] · [[track:016]] — Till, cash receipts, day-anchored till. Q2's
  precedent for a commission-free settlement path lives here.
- [[track:022]] — Short QR URLs. The other half of what a guest meets at the lounger.
- `.claude/rules/payments.md` — agent/marketplace model, never net the fee out of partner revenue,
  never add it to the consumer total.
- Vendor docs: Viva marketplaces (`developer.viva.com/marketplaces/`), Viva ISV partner program
  (`developer.viva.com/isv-partner-program/`), Viva Android terminal app
  (`developer.viva.com/apis-for-point-of-sale/card-terminal-apps/android-app/`), Mollie Tap to Pay
  on Android (`mollie.com/products/pos-payments/tap-to-pay-on-android`).
