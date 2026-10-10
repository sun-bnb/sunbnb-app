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

- **State:** S0 committed. All apps still run Next 14 / React 18.
- **Next action:** S1 (admin) Commit A — Next 15.5 + React 19 + async-API codemod.
- **Watch:** one React 18 at the root, mobile's 19 nested, a single `@types/react` 19.2.7 everywhere. Each app upgrade must leave the others on 18 (`npm ls react`).

## Roadmap

- [x] **S0 Shared prep** (done 2026-10-10, one commit, no runtime change)
  - `packages/{ui,schematic,schematic-editor,table-reservations-ui}`: react/react-dom/@mui → `peerDependencies` (`^18.3.1 || ^19.0.0`). `data` keeps a react peer; `eslint-config`/`typescript-config` drop React.
  - `@types/react(-dom)` → `^19` everywhere, `tsc` errors fixed by hand.
  - App `lint` scripts: `next lint` → `eslint <dirs>` limited to next lint's default dirs (`app components lib`, whichever exist). Plain `eslint .` also lints config files and `coverage/`, which fail the typed parser. Warning counts are identical to `next lint`.
  - `apps/docs` deleted (founder call).
- [ ] **S1 admin.** Commit A: Next 15.5 + React 19 + async-API codemod + next-auth beta.32. Commit B: Next 16.4, `middleware.ts` → `proxy.ts`.
- [ ] **S2 marketing.** A then B. next-intl 4 (`getRequestConfig` returns `locale`); re-verify GA4/PostHog/consent.
- [ ] **S3 partner** (`partner-dev`). ~31 async-params files, 3× `useFormState` → `useActionState`, x-date-pickers 7, Stripe Connect embeds, schematic grid.
- [ ] **S4 user** (`user-dev`). ~55 async-params files, `useFormState`, x-date-pickers 7, drop unused `@mui/material-nextjs`, **`@react-three/fiber` 8 → 9 + `@react-three/drei` 9 → 10** (fiber 8 is React 18 only; then delete `apps/user/react-three-jsx.d.ts`), react-pdf, payment return/webhook routes, `/embed` headers.
- [ ] **S5 Close-out.** Tighten shared peer ranges to `^19`. Update the CLAUDE.md tech-stack row. Wiki ingest.
- [ ] **S6 (follow-up).** ESLint 9 flat config + replace deprecated `@vercel/style-guide`.

Per-app recipe and verification checklist: see the plan file.

## Open decisions

- Custom HTTPS `server.js` vs `next dev --experimental-https` if Next 16 / Turbopack balks at the programmatic API.

## Log

- 2026-10-10: Track created from the approved plan. Versions checked on npm: next 16.4.0, react 19.3.0, next-intl 4.14.9, next-auth beta 5.0.0-beta.32 (peer next ≤16), @mui/x-date-pickers v6 caps react-dom 18 (→ v7), next-intl 3 caps next 15 (→ v4), eslint-config-next 16 needs ESLint ≥9.
- 2026-10-10: **S0 done.** Deleted `apps/docs`. Shared packages now take react/react-dom (+ MUI) as peers (`^18.3.1 || ^19.0.0`); `@repo/data` keeps a react peer for its `.tsx` components; eslint-config/typescript-config drop React. `@types/react(-dom)` `^19.2.0` everywhere. Hand fixes instead of the codemod (only ~15 sites): argument-less `useRef<T>()` → `useRef<T | undefined>(undefined)`, global `JSX.Element` → `import type { JSX } from 'react'`. **Finding:** `apps/user` `components/landing/beach-scene.tsx` uses `@react-three/fiber` 8 (peer react `<19`). Its intrinsics sit on the removed global JSX, so `apps/user/react-three-jsx.d.ts` bridges them into `React.JSX` until S4 moves to fiber 9. Verified: tsc clean in every workspace (except the pre-existing `packages/data` TS2209 rootDir error), lint = baseline, `turbo test` 10/10, `turbo build` for all four apps green.

## Links

- `.claude/rules/deploys.md` — user runs promote/deploy manually.
- `.claude/rules/architecture.md` — shared-package / `@repo/data` blast radius.
