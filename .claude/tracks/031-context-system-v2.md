---
id: 031-context-system-v2
title: Context system v2 — close the curation loop (health signal, cross-layer recall, groom, budgets)
status: done
created: 2026-10-12
updated: 2026-10-13
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

- **DONE 2026-10-13.** The curation loop is closed: one health signal at session start and push,
  tiered cross-layer recall with credits, `/groom`, generated registries, canon inside
  `budgets.json`, and the model written down in `.claude/wiki/subsystems/context-system.md`.
  Health 13 broken / 84 warn → 1 broken / 18 warn (`.claude/context/health-history.jsonl`).
- **Handed off (not context work), from P5 verification — pick up as product tasks:**
  1. `packages/data/src/settlement.ts#generateSettlement` selects only reservation/order invoices:
     rental, table-deposit and dine-in tab revenue never reaches a partner settlement.
  2. `/api/payment/create` releases a tab claim on `no_checkout` after the provider was called;
     the Mollie tab route keeps it (wiki `flows/table-booking.md`).
  3. `PROJECT_CONTEXT.md` (human-owned) documents the deleted `apps/user/app/api/_lib/stripe.ts` —
     the one BROKEN left in the health check.
- **Follow-ups for the normal cadence:** re-groom partner-dev (39.9 KB, soft 30) after track 030
  closes; shrink playbook entries now in canon to pointers at the next grooms; packaging the
  system for other monorepos would be a new track (engine/instance split, plugin + init skill).

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
- ✅ **P5** — canonical compaction (2026-10-13): user 34.4→12.3 KB, partner 35.5→13.1 KB, data
  36.5→14.4 KB, root 17.8→15.2 KB; pulled siblings `apps/user/{HW-API,PATTERNS}.md`,
  `apps/partner/{ASSISTANT,PATTERNS}.md`, `packages/data/EXPORTS.md`; pointer `CLAUDE.md` for
  `apps/marketing` + `packages/agent`; one loading-model statement (root § Context system) reused
  by `/update-knowledge`, wiki README, `help.md`; `/update-knowledge` reads `budgets.json`; all 14
  queued promotions applied; 10 stale wiki pages re-verified; 6 groom ingests; commands got frontmatter.
- ✅ **P6** (2026-10-13) — `wiki/subsystems/context-system.md`; `help.md` rewritten against it; nine
  maintenance workflows re-verified; README/index fixed; user memory 25 → 14 files (10 repo
  duplicates deleted after confirming or folding each lesson into canon; profile refreshed;
  one frontmatter format); nine stale tracks closed or paused (founder-approved); Planned-list
  parser bug fixed in `context-health.mjs`; sync cursor set at HEAD; final snapshot.

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
- **2026-10-13 — P5.** Five parallel agents with disjoint file ownership (user, partner, data +
  rules, wiki ingests, wiki re-verify); the orchestrator kept root, admin, `auth.md`, the shared
  loading statement, `log.md` and `index.md` so no file had two writers. Verification against
  code corrected far more than the queued promotions: canon was missing 15 user API routes and 9
  pages, claimed Viva online was unwired, described invoice numbering as a per-type `FOR UPDATE`
  sequence (it is per-issuer series under an advisory lock), and the partner auth as Google-only.
  Decision: libraries whose canon is a wiki subsystem page (schematic*, table-reservations-*,
  floor-core) are `optionalWorkspaces` in `budgets.json` rather than getting thin CLAUDE.md files.
  Health: 10 broken / 76 warn → 1 broken / ~46 warn.
- **2026-10-13 — P6, track closed.** One agent re-verified the nine workflow pages; the
  orchestrator wrote the context-system page, help, index/README, track and memory changes.
  Memory deletions were confirmed against canon first: the offline-only split rule, the npm /
  no-global-installs rule and the kill-dev-server-before-edits rule had no canonical home and were
  added (state-machine wiki page, root `CLAUDE.md`) before their memory files went. The sync
  cursor was set at HEAD rather than replaying a sync, because P5/P6 had just verified canon and
  wiki against the current code — a replay would have re-done that work.

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
