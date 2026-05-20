---
description: Make an intelligent commit following .claude/rules/commits.md
argument-hint: "[optional: what to emphasize / a message hint]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(git rev-parse:*), Bash(git log:*), Bash(git show:*)
---

Make a commit following **`.claude/rules/commits.md`** — the source of truth (re-read it if
it isn't already in context). Optional emphasis from the user: **$ARGUMENTS**

Current state:

- branch: !`git rev-parse --abbrev-ref HEAD`
- !`git status -sb`
- !`git --no-pager diff --stat HEAD`

Now, working through the rules:

1. **Understand the change.** Read the real diff for the files you intend to commit
   (`git --no-pager diff <paths>`), not just the stat. Identify the *single logical change*.
   If the tree mixes unrelated work, stage **only** the relevant paths and tell the user
   exactly what you're leaving uncommitted. Watch for files that carry pre-existing edits
   beyond the change you mean to make.
2. **Safety.** Confirm you are not on `test`/`production`. Confirm no secrets, `.env*`, certs,
   or build artifacts are being staged.
3. **Verify (code only).** If staging `.ts`/`.tsx`, run a quick typecheck + lint on the
   touched workspace; skip for docs/config-only. Abort the commit on failure — fix or ask.
4. **Stage** the chosen paths explicitly — no `git add -A` / `git add .`.
5. **Write the message for the next agent reading git history** (per the rules): a specific,
   self-describing imperative subject ≤72 chars (no period, no `type(scope):` prefix) leading
   with the affected surface; a body carrying the *why / trigger / rejected alternatives* —
   not a restatement of the diff — in greppable file/symbol/subsystem vocabulary so `--grep`,
   pickaxe, and `blame`→`show` land here; then trailers: `Co-Authored-By: Claude Opus 4.7
   (1M context) <noreply@anthropic.com>` (plus `Refs:` when it links a real issue/track/wiki page).
6. **Commit**, then show `git --no-pager show --stat --oneline HEAD`. Do **not** push.
