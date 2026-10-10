---
id: 029-next16-react19-upgrade
title: Next.js 16 / React 19 upgrade — one web app at a time
status: active
created: 2026-10-10
updated: 2026-10-10
worktree: null
---

## Goal

Move every production web app (`admin`, `marketing`, `partner`, `user`) from **Next 14.2.35 /
React 18.3.1** to **Next 16.4 / React 19.x**, one app at a time, with every intermediate state
deployable. Out of scope: MUI 5→7, Tailwind 3→4, Prisma, `apps/mobile` (already React 19.2.3).

Plan of record: `~/.claude/plans/plan-upgrade-to-latest-ticklish-snail.md` (approved 2026-10-10).

## Resume here

- **State:** S1 done: admin on Next 16.4.0 / React 19.3.0, committed, not pushed. Other apps still Next 14 / React 18.
- **Next action:** push admin to `main` → check the Vercel preview → user promotes. Then S2 marketing.
- **Carry forward to S3/S4 (MUI apps):** add `AppRouterCacheProvider` from `@mui/material-nextjs/v16-appRouter` (v9.5, MUI-version-agnostic) around the root layout, or every page fails hydration under Next 16. Also add `allowedDevOrigins: ['local.sunbnb.app']`.
- **Watch — co-location invariant:** each app's `next` must resolve the SAME `react` as the app, and every Next-coupled package (`next-auth`, later `next-intl`) must resolve the app's own `next`. The root `devDependencies` pin the OLD stack (`next@14.2.35`, `react`/`react-dom@18.3.1`, `next-auth@5.0.0-beta.30`), so a migrated app nests its new versions together. A migrated app must request a version DIFFERENT from the root pin for every coupled package, or npm dedupes it to the root. Check with the resolve one-liner in the S1 log. Remove the pins in S5.

## Roadmap

- [x] **S0 Shared prep** (done 2026-10-10, one commit, no runtime change)
  - `packages/{ui,schematic,schematic-editor,table-reservations-ui}`: react/react-dom/@mui → `peerDependencies` (`^18.3.1 || ^19.0.0`). `data` keeps a react peer; `eslint-config`/`typescript-config` drop React.
  - `@types/react(-dom)` → `^19` everywhere, `tsc` errors fixed by hand.
  - App `lint` scripts: `next lint` → `eslint <dirs>` limited to next lint's default dirs (`app components lib`, whichever exist). Plain `eslint .` also lints config files and `coverage/`, which fail the typed parser. Warning counts are identical to `next lint`.
  - `apps/docs` deleted (founder call).
- [x] **S1 admin.** ✅ Commit A: Next 15.5 + React 19 + next-auth beta.32 (nested). ✅ Commit B: Next 16.4, `middleware.ts` → `proxy.ts`, `AppRouterCacheProvider`.
- [ ] **S2 marketing.** A then B. next-intl 4 (`getRequestConfig` returns `locale`); re-verify GA4/PostHog/consent.
- [ ] **S3 partner** (`partner-dev`). ~31 async-params files, 3× `useFormState` → `useActionState`, x-date-pickers 7, Stripe Connect embeds, schematic grid.
- [ ] **S4 user** (`user-dev`). ~55 async-params files, `useFormState`, x-date-pickers 7, drop unused `@mui/material-nextjs`, **`@react-three/fiber` 8 → 9 + `@react-three/drei` 9 → 10** (fiber 8 is React 18 only; then delete `apps/user/react-three-jsx.d.ts`), react-pdf, payment return/webhook routes, `/embed` headers.
- [ ] **S5 Close-out.** Remove the root old-stack pins (`next`, `react`, `react-dom`, `next-auth` in root `devDependencies`). Tighten shared peer ranges to `^19`. Update the CLAUDE.md tech-stack row. Wiki ingest.
- [ ] **S6 (follow-up).** ESLint 9 flat config + replace deprecated `@vercel/style-guide`.

Per-app recipe and verification checklist: see the plan file.

## Open decisions

- ~~Custom HTTPS `server.js` vs `next dev --experimental-https`~~ resolved: `server.js` works unchanged on Next 16 (admin, 2026-10-10).

## Log

- 2026-10-10: Track created from the approved plan. Versions checked on npm: next 16.4.0, react 19.3.0, next-intl 4.14.9, next-auth beta 5.0.0-beta.32 (peer next ≤16), @mui/x-date-pickers v6 caps react-dom 18 (→ v7), next-intl 3 caps next 15 (→ v4), eslint-config-next 16 needs ESLint ≥9.
- 2026-10-10: **S0 done.** Deleted `apps/docs`. Shared packages now take react/react-dom (+ MUI) as peers (`^18.3.1 || ^19.0.0`); `@repo/data` keeps a react peer for its `.tsx` components; eslint-config/typescript-config drop React. `@types/react(-dom)` `^19.2.0` everywhere. Hand fixes instead of the codemod (only ~15 sites): argument-less `useRef<T>()` → `useRef<T | undefined>(undefined)`, global `JSX.Element` → `import type { JSX } from 'react'`. **Finding:** `apps/user` `components/landing/beach-scene.tsx` uses `@react-three/fiber` 8 (peer react `<19`). Its intrinsics sit on the removed global JSX, so `apps/user/react-three-jsx.d.ts` bridges them into `React.JSX` until S4 moves to fiber 9. Verified: tsc clean in every workspace (except the pre-existing `packages/data` TS2209 rootDir error), lint = baseline, `turbo test` 10/10, `turbo build` for all four apps green.
- 2026-10-10: **S1 Commit A (admin → Next 15.5.27 / React 19.3.0).** First build failed prerendering `/404` with React #31: npm hoisted admin's `next` into the free ROOT slot (left by `apps/docs`), where `require('react')` found root React 18 while the app rendered React 19. Then `next-auth` (root, deduped) imported root Next 14's `next/server` (type error, and a wrong-instance runtime bug for cookies/headers). Fix: root `devDependencies` pin the old stack, and admin requests `next-auth@5.0.0-beta.32` exactly so it nests beside its Next (partner/user stay on beta.30; beta.30 would also have supported Next 16, so the bump is only for placement). Shared `packages/*` import nothing from next/next-auth/next-intl, so they are unaffected. Only `app/audit/page.tsx` read `searchParams` synchronously; the other pages were already `Promise`-typed. Added `allowedDevOrigins: ['local.sunbnb.app']` (Next 16 blocks cross-origin dev `/_next/*` otherwise). Verify: resolve check `cd apps/<app> && node -p 'const p=require("path"),n=require.resolve("next/package.json");require(n).version+" next→react "+require(require.resolve("react/package.json",{paths:[p.dirname(n)]})).version+" app react "+require("react/package.json").version'`. tsc/lint (20 warnings = baseline)/244 tests/build green; untouched apps rebuilt green. Browser (headless, minted sudo session cookie, `server.js` HTTPS dev unchanged): 13 pages + partner detail + `/audit?targetUserId=` render 200 with 0 console errors/warnings.
- 2026-10-10: **S1 Commit B (admin → Next 16.4.0).** `middleware.ts` → `proxy.ts` (function renamed, logic untouched). The Turbopack build worked with no config changes. `server.js` (programmatic `next({ dev })` over mkcert HTTPS) works unchanged, so that open decision is resolved for admin. **Finding:** under Next 16 dev EVERY page threw a hydration mismatch (none on 15): MUI/Emotion rendered `<style data-emotion>` inline during SSR while the client inserts into `<head>`. Admin never had an App Router Emotion cache. Fix: `@mui/material-nextjs@9.5` `v16-appRouter` `AppRouterCacheProvider` wrapping the root layout. v9 has no `@mui/material` peer, so it works with MUI 5. Root still holds user's unused v5, so admin's copy nests beside its Next 16, consistent with the invariant. Verify: tsc / lint (20 = baseline) / 244 tests / Turbopack build green. Dev browser pass: 14 routes 200, 0 console issues. Proxy: signed-out page requests 307 → `/sign-in?callbackUrl=…`, `/api/health` public. `next start` probe: same, plus a single head-flushed emotion style block. A lone "destination stream errored" log line was the script navigating away mid-stream; it didn't recur when the page loaded fully.

## Links

- `.claude/rules/deploys.md` — user runs promote/deploy manually.
- `.claude/rules/architecture.md` — shared-package / `@repo/data` blast radius.
