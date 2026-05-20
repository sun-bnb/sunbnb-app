# Commit Rules

How to make a commit in this repo. These apply to **every** commit, however it's
triggered. Do **not** commit on your own initiative — only when the user asks; these rules
govern *how* you commit once a commit is requested. **Commit ≠ push** — push only when
explicitly asked.

## Before you commit

- **Inspect first.** Run `git status` and `git diff` (and `git diff --staged`) to see the whole change set. Never commit blind.
- **One logical change per commit.** If the working tree mixes unrelated work, stage selectively by path; don't lump. State plainly what you're leaving uncommitted.
- **Staging discipline.** Prefer explicit paths over `git add -A` / `git add .`. `git add <file>` stages that file's *entire* diff vs HEAD — if it carries pre-existing unrelated edits, surface them and decide deliberately rather than bundling them silently.
- **Secret & noise safety.** Never stage `.env*`, credentials, tokens/keys, connection strings, certificates, or build artifacts. Scan the diff for accidental secrets before committing. (`.claude/settings.local.json` is gitignored — keep it so.)
- **Branch awareness.** `main` is the working branch (deploys to Vercel preview). **Never** commit directly to `test` or `production` — those branches advance only via `./promote-to-test.sh` / `./deploy-to-production.sh`. If you're on `test`/`production`, stop and confirm with the user before doing anything.

## Verify before committing (code changes only)

- When the commit touches `.ts` / `.tsx` source, run a **quick check on the touched workspace** first: typecheck + lint, e.g. `cd apps/<app>` (or `packages/<pkg>`) then `npx tsc --noEmit && npm run lint`.
- **Skip** verification for docs/config-only commits (`*.md`, `.claude/**`, JSON/config). A full `turbo build`/test run is not required per commit.
- If the quick check fails, do **not** commit — report the failure and fix it or ask first. Never knowingly commit broken code.

## Message format — write it for the next agent reading git history

A commit message exists to carry what the **diff cannot**. Claude Code (or any AI dev tool)
reaches into history via `git log --oneline` (scan), `git log --grep` and pickaxe
(`git log -S` / `-G`) (find where/why something changed), `git blame` → `git show <sha>`
(why a line exists), and `git bisect` (what broke). Optimize the message so those land on
the right commit and explain it with **no external context**. (Same discipline as the `kb:`
markers in `.claude/agent-protocol.md`: self-contained, why-first, entity vocabulary.)

- **Subject = the scan line.** Capitalized, imperative, ≤72 chars, no trailing period, no
  Conventional-Commits `type(scope):` prefix (repo voice). Make it *specific and
  self-describing* — an agent reading `git log --oneline` must judge relevance without
  opening the diff. Lead with the affected surface (app / package / subsystem / symbol),
  e.g. *"Ingest subagent transcripts into the knowledge store"*, *"Fix VAT rounding in
  @repo/data invoice lines"*. **Ban vague subjects** — "UI improvements", "fixes", "updates".
- **Body = the why, not the what.** The diff already shows *what* changed — do not restate
  it line by line. Spend the body on what the diff can't show: the **trigger/constraint**
  (what was broken or forced this), the **rationale**, and any **non-obvious decision or
  rejected alternative**, so a future agent doesn't re-derive or re-litigate it. Wrap ~72 cols.
- **Be greppable.** Use the exact tokens an agent would search for — real file paths,
  function/symbol names, and subsystem/domain-entity nouns (reservation, settlement, invoice,
  payment, inventory, schematic…). This is what makes `--grep` and pickaxe land on this commit.
- **Be self-contained.** Readable from `git show <sha>` alone, months later. A bare "see PR
  #123" is not a rationale.
- **Be dense, high-signal.** An agent pays context budget for every message it reads — no
  filler, no diff narration. Omit the body only for genuinely trivial one-liners.
- **Atomic** (see staging rules): one logical change per commit keeps `blame`/`bisect`
  attribution meaningful.

### Trailers (machine-parseable `Key: value`, in a final paragraph)

- **Always:** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- **When it links something real:** `Refs:` an issue/PR, a track, or a wiki page — e.g.
  `Refs: .claude/tracks/001-knowledge-store.md`. Trailers are for genuine, greppable links;
  don't manufacture ceremony.

## After committing

- Show the result: `git --no-pager show --stat --oneline HEAD`.
- Report what was committed and, if anything was deliberately left out of the commit, what remains uncommitted. Do not push.
