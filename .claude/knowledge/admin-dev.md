# admin-dev playbook

`admin-dev`'s curated, growing memory for `apps/admin`. Governed by
`.claude/knowledge/README.md` (layer spec + trust ladder). Grow it via the gated
retrospective; curate it via `workflows/groom.md`.

## Navigation index

What this playbook knows, by theme. Maintained by grooming; scan it before reading
sections. *(Empty — entries are added as the agent learns.)*

- **Settlement lifecycle** — DRAFT→CLOSED→APPROVED→PAID + revert edge cases — _none yet_
- **Fee cascade** — three-tier resolution (site → partnerAccount → settings) — _none yet_
- **Sudo auth** — `requireSudo` guard / session edge cases — _none yet_
- **Test failures & fixes** — known-bugs asserted by tests, mock setups — _none yet_
- **Rejected approaches** — dead-ends, so nobody re-tries them — _none yet_

---

## Settlement lifecycle

<!-- Entry format:
### YYYY-MM-DD: <concise title>
**Problem:** what went wrong / what was non-obvious
**Solution:** what actually worked
**Prevention:** how a future session avoids it (cite path/file.ts#symbol) -->

## Fee cascade

<!-- Edge cases in three-tier fee resolution (site → partnerAccount → settings) -->

## Sudo auth

<!-- Unexpected behaviors in the requireSudo guard, session edge cases -->

## Test failures & fixes

<!-- Non-obvious mock setups; known bugs the tests deliberately assert against -->

## Rejected approaches

<!-- Approaches tried and rejected — record so a future session doesn't re-try them -->
