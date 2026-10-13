---
id: 031-context-system-v2
title: Context system v2 — close the curation loop (health signal, cross-layer recall, groom, budgets)
status: active
created: 2026-10-12
updated: 2026-10-12
worktree: null
---

## Goal

Keep the six-layer context system (canonical `CLAUDE.md` tree + rules · wiki · playbooks ·
recall store · tracks · user memory) and make it **self-maintaining**: every write path was
already automated, but no curate/prune/promote path had ever run (all 2,950 recall records
`raw`, playbooks never groomed, wiki never linted, drift hook never wired, `/context sync`
never run, four canonical files over cap). End state:

1. **One health signal** — `context-health.mjs` covers every layer, prints at SessionStart and
   in pre-push (warn-only), names the fix command for each finding.
2. **Pull by relevance** — playbooks, wiki sections and track Resume-heres are indexed into
   the vector store as labelled tiers; agents read a playbook's nav index + one cross-layer
   recall, not 87 KB whole.
3. **Feedback closes the loop** — recall hits are credited; credits + recurrence feed `/groom`,
   which proposes promotions (never silent).
4. **Registries are derived** — track index and playbook nav indexes are generated.
5. **Budgets nag, never block** — `.claude/context/budgets.json` is the single table.

Design doc: `~/.claude/plans/we-have-equipped-this-greedy-volcano.md` (diagnosis, principles,
per-phase file lists, verification).

## Resume here

- **Next action:** P5 — canonical compaction to budget, one big `CLAUDE.md` per session (user, partner, data, then root), applying the queued promotions below while each file is open (plan file §P5).
- **P5 per file:** keep route/action/API tables, move narrative to a pulled sibling
  (`apps/user/HW-API.md`, `apps/partner/ASSISTANT.md`, `packages/data/EXPORTS.md`) or the wiki page
  that already covers it; fix stale facts (Vitest 5, TS 6, partner auth = Google + Facebook +
  Credentials per `apps/partner/app/auth.ts`, ONE loading-model statement reused by
  `update-knowledge.md` / `wiki/README.md` / `help.md`); `/update-knowledge` reads
  `.claude/context/budgets.json`; re-verify the 11 stale wiki pages + fix the 2 BROKEN citations
  while their canonical sections move; `node .claude/scripts/context-health.mjs --scope canonical`
  must drop the file's BROKEN line.
- **Queued canon promotions from the P3 grooms** (apply with `/update-knowledge` / `/wiki ingest`;
  each gate-checked by its groom, source entry named in the playbook):
  - `packages/data/TESTING.md` — shared `sunbnb_test` is cross-session mutable state: serialize
    integration suites across agents, `pg_stat_activity` before blaming infra, no `git stash`
    (partner-dev + user-dev entries 2026-07-25; collapse both to pointers afterwards).
  - `.claude/rules/migrations.md` — never background `migrate dev` (advisory lock, P1002); when
    Prisma refuses a non-interactive shell on a warning, `migrate diff … --script` into a
    timestamped dir → `migrate deploy` → `generate` → `migrate:check`; "unique among active rows"
    = nullable `@unique` NULLed on close, never a partial index (data-dev).
  - `.claude/rules/data-access.md` — Prisma `upsert` is SELECT-then-INSERT: catch P2002 + refetch
    is the convention under RSC prefetch concurrency (partner-dev).
  - `apps/partner/TESTING.md` — auth-matrix predicate semantics (`AUTH_ERROR_MESSAGES`, "ok"
    scenarios run the body, routes have no runner → `UNGATED_ALLOWLIST`), mock-contract traps,
    no React component tests / no jsdom (partner-dev).
  - `apps/partner/CLAUDE.md` — `inventory/actions.ts` bulk ops do not `revalidatePath`; they rely
    on the client's scoped `refreshItems()` (track 020) — new actions pick one deliberately
    (sunbed-inventory).
  - `apps/user/TESTING.md` — anon fixtures must be UUID v4; mock-shape checklist (every
    `prisma.<model>.<method>` and `@repo/data` export in `__mocks__` or the vitest alias list) (user-dev).
  - `apps/user/CLAUDE.md` — line ~78 and `api/_lib/payment-ids.ts` header still say "extracted
    from the removed Stripe lib"; reword provider-neutral (Stripe Connect is back via
    `/api/payment/create`) (user-dev).
  - `apps/admin/CLAUDE.md` — Testing: `updatePaymentProvider` is a readiness gate over
    mollie/viva/stripe, not "Mollie token verification"; Mocking: current Prisma mock tables
    (+ device, customSubscription, platformPreference, featureFlag, impersonationLog) and the
    `promotion-db.ts` mock; document `/flags`, partner tax identity, `/leads`, `/verifactu` (admin-dev).
  - `packages/data/CLAUDE.md` — § Testing: `npx tsc --noEmit` is a real gate now (rootDir fixed);
    § Payment providers: zero-commission Stripe still yields a processing-only PLATFORM invoice,
    zero-commission Mollie is invoice-less (data-dev).
  - `/wiki ingest subsystems/payments` — `syncEffectiveProvider` rewrites every site of an account
    on any partner connection change; the admin per-site override is a repair tool, not config (admin-dev).
  - `/wiki ingest subsystems/schematic-editor` — `SchematicItem.groupId` is the renderer's only
    co-move AND pair-highlight key (`pairId` gone); the two drag sites in `SchematicRenderer.tsx`
    (`handleUp` + render-time `followDrag` IIFE) must change together (sunbed-inventory).
  - `/wiki ingest subsystems/reservation-state-machine` — card-present: `cardPresent` condition,
    `vivaSale`/`vivaAbort` effects, row order above the QR rows, "abandon may stay processing" (data-dev).
  - `/wiki ingest subsystems/partner-assistant` — track-030 invariants (jsonb key order → sorted
    diffBasis; sudo applies patch the owner's rows; payloads hold names not ids; snapshot mocks
    copy rows) so partner-dev's 9 assistant entries can shrink (partner-dev).
  - `/wiki ingest flows/table-booking` — tab payment claim rule (revert only on pre-commitment
    failures; `releaseTabClaim` idempotent, skipped on `provider_error`) and "only terminal
    transitions null `openTableId`" (user-dev).
- **Context needed:** plan file §P5; `node .claude/scripts/context-health.mjs --scope canonical`
  for the live list; `.claude/context/budgets.json`.
- **Done so far:** P0 · P1 · P2 · P3 · P4 (see roadmap). P6 after P5.
- **Blocked by:** nothing.

## Roadmap

- ✅ **P0** — open this track (2026-10-12).
- ✅ **P1** — `context-health.mjs` (wiki · canonical · playbooks · tracks · agents · `--with-store`),
  `budgets.json`, committed `.claude/settings.json` (SessionStart summary + knowledge hooks),
  `.githooks/pre-push` summary line, dead hook path removed, `detect-drift.mjs` → shim.
- ✅ **P2** — cross-layer retrieval (2026-10-12): `knowledge-curated.mjs` indexes playbook entries,
  wiki sections and track resume-heres (403 units, SHA-upsert, detached from SessionStart);
  `knowledge-recall.mjs` rewritten — tiered output, `--surface`, `--layer`, `--json`, status
  boost, `--credit`, `--candidates`; `playbook-index.mjs` generates every nav block; schema
  `hits/last_hit/content_sha`; `type` validated on ingest; five agent skeletons + protocol §4
  read index + recall and credit hits; track 001 refreshed and paused.
- ✅ **P3** — `/groom <agent>` (2026-10-12); `/update-knowledge` + `groom.md` reconciled; all five
  playbooks groomed by parallel agents: 162 KB → 120 KB, every entry v2 with `tags:`, 0 broken
  citations, stale lessons deleted only after opening the cited code; 9 inbound promotions
  written (33 episodic records credited → verified); 14 outbound canon proposals queued below
  for P5. partner-dev sits at 39.9 KB (soft 30): re-groom after track 030 closes and its
  invariants are ingested into `wiki/subsystems/partner-assistant.md`.
- ✅ **P4** — `tracks-index.mjs` generates `index.md`; sub-docs carry `parent:`; status truth pass
  (029/008/009/010 done, 024 blocked, 020 paused, 003 proposed, 011/013/016 frontmatter);
  030 Resume-here corrected. *Deferred to P2:* track-001 roadmap refresh.
- ☐ **P5** — canonical compaction to budget (`apps/user/HW-API.md`, `apps/partner/ASSISTANT.md`,
  `packages/data/EXPORTS.md`, root map + env list), stale facts (Vitest/TS versions, partner
  auth, ONE loading-model statement), `/update-knowledge` reads `budgets.json`, re-verify the
  11 stale wiki pages + 2 broken citations.
- ☐ **P6** — user-memory dedupe (ask first), `wiki/subsystems/context-system.md`, `help.md`
  rewrite, `/context health|groom`, wiki README/index fixes, commit `AGENTS.md`, first
  `/context sync` to set the cursor, `--snapshot` baseline.

## Log

- **2026-10-12 — P0/P1/P4.** Mapped all layers with three explorers (findings in the plan's
  Context table). Built `context-health.mjs` (0.4 s, 15 broken · 92 warn on the pre-pass tree)
  and `tracks-index.mjs`; hooks moved from the gitignored `settings.local.json` into a committed
  `.claude/settings.json`. Decision: hard caps report as BROKEN, soft as WARN, nothing blocks.
  Decision: the registry's "next action" is the first line of Resume-here, capped at 220 chars —
  the long hand-written index rows (up to 8 KB) were the drift source. Deleted the never-wired
  `.git/hooks` path (`core.hooksPath=.githooks` made it unreachable). Folded
  `030-d1-progress.md` into track 030's log and deleted it.

- **2026-10-12 — P2.** Curated indexing chose *one store, labelled by source* over a second
  index: one query, one ranking, trust visible per hit. Wiki sections are chunked at ~1.6 KB
  (bge-small truncates past ~512 tokens); workflow pages are excluded from the wiki tier in
  `--surface` mode because they outranked domain pages on generic phrasing. `--candidates` is
  surface-scoped by `files[]` prefixes (`budgets.agents.surfaces`), credits only rank — a
  credited record from another surface must not pollute an agent's groom. First credited
  record: #2036 (the `migrate dev` advisory-lock trap).
- **2026-10-12 — P3.** Five parallel groom agents (one playbook each; the orchestrator ran the
  curated re-index and snapshot once afterwards to avoid concurrent store writes). Results:
  partner-dev 85→40.9 KB (2 entries deleted after code proved them obsolete, 9 assistant
  entries reflowed to a canon pointer + gotchas), data-dev 43→30.7 KB (8 one-lesson sections
  folded into 4 themes, Viva packets 17.5→6 KB), user-dev 25→23.5 KB (4 merges, the
  pair/pairedBy lesson retired by track 021), sunbed-inventory 3→5 entries (all 3 revised
  against tracks 021/030), admin-dev 0→5 entries from episodic candidates. Grooms also found
  canon errors the playbooks had been quietly correcting for (admin `CLAUDE.md` testing
  section, user `CLAUDE.md` "Stripe purged" wording) — queued in Resume here. Decision:
  `--candidates` stays surface-scoped; two agents correctly refused off-surface clusters.
  Store after P3: 162 verified / 290 promoted / 3,154 raw, 44 credits.

## Open decisions

- Near-duplicate detection in the store (`--candidates`) — cosine self-join on ~3k rows is
  fine today; revisit indexing if the store passes ~20k.
- Out of scope here: track 001 Phase 1 (Vercel log-drain adapter); the Obsidian / Claude.ai
  Team plan (`.claude/plans/ai-infrastructure.md`); any auto-curation that writes without a
  visible proposal.

## Links

- [[track:001-knowledge-store]] — the store this track promotes out of
- [[subsystem:context-system]] — to be written in P6 (the layer map this track establishes)
- `.claude/context/budgets.json` · `.claude/scripts/context-health.mjs` · `.claude/scripts/tracks-index.mjs`
