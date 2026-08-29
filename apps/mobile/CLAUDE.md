# Mobile App (apps/mobile)

React Native floor app for on-site staff — iOS + Android. **Not built yet.** This file is the
context boundary; the RN scaffold, `package.json` and workspace wiring land at P7 of
[[track:024]] (`.claude/tracks/024-card-present-payments.md`). Until then `apps/*` globs this
directory as a workspace but npm skips it, so the lockfile stays untouched.

## Why it exists

Card-present payments. The floor can take cash or show a QR the guest pays on their own phone;
neither serves a guest standing at the parasol with a card. Viva's softPOS is reachable only
from a native app, so the floor surfaces move onto one.

**In this monorepo, not a separate repo** — it shares `@repo/data`, the rules tree, the wiki,
and the single-writer ratchet. A separate repo would have meant copying logic and syncing it.

## Scope boundary

**In:** the token-gated on-site surfaces — the manage grid (`apps/partner/app/sites/[id]/manage`)
and the order dashboards (`sites/[id]/orders`, later `restaurants/[id]/orders`).

**Out:** the partner portal (session/Google-OAuth surfaces — sites, inventory, accounting,
calendar, `frontdesk`), the consumer app, admin.

The line is the auth model: this app carries a `SecurityToken` access key, never a NextAuth
session. That is why the scope is what it is — see `apps/partner/app/sites/[id]/manage/token.ts`
`validateManageToken`.

## Three constraints that shape everything

- **RN cannot call Next server actions.** No public HTTP contract exists for them, and
  `apps/partner/app/sites/[id]/manage/actions.ts` is ~3.4k lines of them. The app talks to an
  HTTP layer in front of the gated actions (P6.5), which must keep the
  `verifySiteOwnership(siteId, accessKey)` gate and stay inside the gated-action registry
  (`apps/partner/app/test/gated-actions.ts`) so the auth matrix still covers it.
- **The payment leg cannot run in an emulator, ever.** Play Integrity rejects emulators by
  design and an AVD has no NFC. Day-to-day UI work is fine in emulator/Simulator; the card tap
  needs a real Android 8.1+ NFC handset. Viva's Terminal DEMO app + a demo account give
  simulated transactions with no money moved.
- **The payment UI is Viva's, not ours.** Viva has no embeddable softPOS SDK on either
  platform — payment hands off to the `viva.com Terminal` app via Android intents / iOS URL
  schemes and returns via callback. Our side is: build the request, handle the callback, and
  **verify server-side** — a callback query string is user-typable and is never authoritative.

## Share vs reimplement

**Import, never copy** — the client-safe `@repo/data` modules (`reservation-machine`,
`seat-label`, `site-day`, `unit-address`, `reservation-status`) and the extracted pure logic
(`bed-state.ts`, `grid-helpers.ts`, `seat-selection.ts`, `pos-seat-selection.ts`,
`reservation-day.ts`). Copying any of these puts a second opinion on seat state outside the
single-writer ratchet (`packages/data/src/reservation-machine-guard.test.ts`) — the drift that
would land in till partitioning or collect-abandon, and land silently.

**Reimplement** — screens only. RN renders `<View>`/`<Text>`; JSX and Tailwind do not port.
UI drift is visible; logic drift is not.

## Pointers

- Design record, decisions, roadmap, open questions: `.claude/tracks/024-card-present-payments.md`
- Reservation state machine (the app is a *reader* of it): `packages/data/CLAUDE.md`
- Floor surfaces being ported: `apps/partner/CLAUDE.md` § manage / orders
- Payment doctrine: `.claude/rules/payments.md`
