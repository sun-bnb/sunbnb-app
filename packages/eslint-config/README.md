# `@repo/eslint-config`

Shared ESLint 9 flat configs. Each workspace has an `eslint.config.mjs` that spreads one of:

- `@repo/eslint-config/next.js`: the Next.js apps. `eslint:recommended` + `@next/next` recommended + turbo, with prettier conflicts off.
- `@repo/eslint-config/react-internal.js`: `packages/*` and `apps/mobile`. Adds TS-aware `no-unused-vars` and turns `no-undef` off for TS. Lints with `--max-warnings 0`.

`base.js` holds the shared pieces. `eslint-plugin-only-warn` turns every problem into a warning.
