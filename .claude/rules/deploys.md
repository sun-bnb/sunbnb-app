# Deploy Rules

How a change moves from your working tree to a live environment. These rules
govern the **verb ladder** — `commit` → `push` → `promote` → `deploy` — and how
authorization for each stage works. They apply to **every** session, including
auto-mode, and they sit on top of `commits.md` (commit hygiene) and
`migrations.md` (DB-migration timing within a deploy).

## The verb ladder

Each verb advances exactly **one** stage. Never advance beyond the stage the
user just named in the **latest** turn. Prior approvals do not carry forward —
neither across stages within the same change, nor across changes within the
same session.

| Verb in the latest user turn | What you may run | Effect |
|---|---|---|
| `commit` (or no verb at all) | `git commit` only | nothing leaves the laptop |
| `push` | `git push origin main` | Vercel **preview** rebuilds |
| `promote` / `promote to test` | `./promote-to-test.sh` | **test.sunbnb.app** rebuilds; TEST DB migrated |
| `deploy` / `deploy to production` / explicit `production` | `./deploy-to-production.sh` | **sunbnb.app** rebuilds; PROD DB migrated |

Ambiguous shorthand — "ship it", "do it", "send it", "let's go" — is **not** a
verb. Default to the lowest reasonable interpretation (usually `commit`,
occasionally `push`) and ask before advancing further. Do not infer the next
stage from how the previous change was deployed, from session momentum, or from
the fact that the scripts are convenient to run.

## Promote and deploy: latest-turn match required

`promote-to-test.sh` and `deploy-to-production.sh` change shared infra that
other users and the live service depend on. Never invoke either script unless
the matching verb appears in the latest user turn **for the specific change in
flight**. Examples that are NOT sufficient authorization:

- "promote to test and then to production" said in a prior turn about a
  previous change. Authorization for one change does not extend to the next.
- "yes" / 👍 / agreement to a question that doesn't itself name the stage.
- A pattern of repeated deploys earlier in the session.
- The script being convenient, the migration being trivial, the change being
  small, or all tests passing.

If you are uncertain whether the user just authorized the next stage, **ask**.
The cost of asking is low; the cost of an unwanted production deploy is high.

## User-facing copy: review gate before promote

User-facing strings — marketing copy, error messages, translations — must be
spot-checked by the user before `promote-to-test` even if typecheck, lint, and
tests all pass. Machine-quality first-pass translations authored by Claude are
the clearest case (partial coverage, idiom mistakes, brand-token bleed), but
the gate covers any string a real user will read. Surface the new keys or the
copy diff explicitly so the user can review before authorizing promote.

## When a deploy script aborts mid-flight

The deploy scripts are written so an abort (failed migration, lock timeout,
merge conflict) leaves the system in a **recoverable** state — no merge, no
push, the target environment untouched. When this happens:

- Stop. Do not improvise around the failure.
- Report current state: which branch you're sitting on, which step failed,
  what is and isn't applied, what the recovery options are.
- Let the user decide whether to retry, wait, force, or back out.
- Never bypass the migrate-before-deploy guard unless the user explicitly
  authorizes the bypass with full knowledge of what it skips
  (see `migrations.md`).

## Cross-reference

- `commits.md` — how to make a commit. **Commit ≠ push.**
- `migrations.md` — DB-migration timing within a deploy (expand/contract,
  migrate-before-deploy, the shared-test-DB pre-push hook).
- `architecture.md` — when a change is large enough to need a design pass
  before any commit.
