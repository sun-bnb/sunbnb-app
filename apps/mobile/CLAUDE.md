# Mobile App (apps/mobile)

Expo / React Native floor app for on-site staff — iOS + Android. The native home of the
token-gated floor surfaces, and the host of Viva card-present payments ([[track:024]]).
**Status: scaffolded and bundling** — pairing flow, tab shell, and a v0 sunbed grid running
against the partner HTTP surface. Screens are being built toward web parity per the approved
mockups (see the track).

## Stack

Expo SDK 57 · React Native 0.86 · React 19 · TypeScript · Expo Router (file routes under
`src/app/`) · StyleSheet + `src/theme.ts` design tokens today (NativeWind planned with the
full screen build). Lives in this monorepo as workspace `mobile`; React 19 / RN deps nest
under `apps/mobile/node_modules` while the Next apps stay on React 18 at the root.

Lint uses the repo's eslint 8 stack (`@repo/eslint-config`), **not** `eslint-config-expo` —
the Expo config hoists to the root where it collides with the workspace's eslint 8. Don't
reintroduce it without solving that.

## Commands

```bash
cd apps/mobile
npm start                 # expo dev server (QR → Expo Go / dev build)
npx tsc --noEmit          # typecheck
npm run lint
npx expo export --platform android   # headless Metro bundle — the "does it build" check
```

`EXPO_PUBLIC_API_URL` points at the partner app origin (default `https://local.sunbnb.app:3001`).

**Testing on a real phone (Expo Go):** the phone can't resolve `local.sunbnb.app` and won't trust
the mkcert cert, so partner's dev server also listens on plain HTTP port **3011** (see
`apps/partner/server.js`). Same Wi-Fi, then:
`EXPO_PUBLIC_API_URL=http://<Mac-LAN-IP>:3011 npm start` and scan the QR with Expo Go.

## How it talks to the backend

RN cannot call Next server actions. The app uses the token-gated HTTP surface in
apps/partner (track 024 P6.5):

- `GET /api/manage/context?siteId&key` — pairing verification → `{ site, isAdmin }`
- `GET /api/manage/grid?siteId&key` — the full grid payload (dates arrive as ISO strings)
- `POST /api/manage/rpc` — `{ action, args }` forwarded to an allowlisted manage server
  action; the allowlist (`apps/partner/app/api/manage/rpc/registry.ts`) is test-enforced to
  be a subset of the gated-action registry, so the auth matrix covers everything exposed.

Client: `src/lib/api.ts`. Auth model: a `SecurityToken` access key, paired once
(`src/app/pairing.tsx` → `src/lib/pairing.ts`, expo-secure-store) — never a NextAuth session,
never a key in a URL. Admin keys unlock the Today tab (till summary / day close / trends).

## Structure

- `src/app/` — routes: `index` (pairing gate) · `pairing` · `(tabs)/{beds,rentals,guests,today}`
- `src/lib/` — `api.ts` (HTTP client) · `pairing.ts` (secure-store + input parsing) · `config.ts`
- `src/theme.ts` — design-language tokens incl. the BedState → color map (mirrors
  `@repo/floor-core/bed-state`'s Tailwind vocabulary)

## Three constraints that shape everything

- **RN cannot call Next server actions** — everything goes through the HTTP surface above;
  new floor actions must be added to the RPC allowlist AND already sit in the gated-action
  registry (`apps/partner/app/test/gated-actions.ts`).
- **The payment leg cannot run in an emulator, ever.** Play Integrity rejects emulators and
  an AVD has no NFC. UI work is fine in emulator/Simulator; the card tap needs a real
  Android 8.1+ NFC handset (Viva Terminal DEMO app + demo account, no money moved).
- **The payment UI is Viva's, not ours.** Card collect = deep link to the `viva.com Terminal`
  app (scheme `sunbnbfloor` carries the callback) → **verify server-side** — a callback query
  string is user-typable and never authoritative.

## Share vs reimplement

**Import, never copy** — `@repo/floor-core` (`types`, `bed-state`, `grid-helpers`) and the
client-safe `@repo/data` modules (`reservation-machine`, `seat-label`, `site-day`,
`reservation-status`). Copying any of these puts a second opinion on seat state outside the
single-writer ratchet. **Reimplement** — screens only (RN renders `<View>`/`<Text>`).

Never import a `@repo/data` submodule that transitively pulls prisma/pg — Metro will choke or
worse, bundle it. `npx expo export` is the check.

## Pointers

- Design record, roadmap, mockups, open questions: `.claude/tracks/024-card-present-payments.md`
- Reservation state machine (this app is a *reader*): `packages/data/CLAUDE.md`
- The web surfaces being ported: `apps/partner/CLAUDE.md` § manage
- Payment doctrine: `.claude/rules/payments.md`
