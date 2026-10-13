---
description: Cross-layer semantic recall over the knowledge store — wiki (canon), playbooks (curated), tracks (intent), past sessions (episodic)
argument-hint: <query> [--surface <agent>] [--layer wiki|playbook|track|episodic|curated] [--k N] [--kc N] [--type T] [--since DATE] [--json] | --credit <id,id> | --candidates <agent>
allowed-tools: Bash(node:*)
---
Recall for: **$ARGUMENTS**

!`node .claude/scripts/knowledge-recall.mjs $ARGUMENTS`

Read the tiers top-down. **Wiki** hits are canon — trust and cite the page. **Playbook** hits are
verified curated entries — apply them, opening the full entry by heading if the excerpt is not
enough. **Track** hits tell you where an effort stands. **Episodic** hits are raw leads from past
sessions — verify each against the current code before relying on it. When a hit helped, credit
it (`--credit <id,id>`): raw records become verified and the credits feed `/groom`.
