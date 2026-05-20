---
description: Semantic recall over distilled knowledge from past Claude Code sessions
argument-hint: <search query>
allowed-tools: Bash(node:*)
---
Episodic recall for: **$ARGUMENTS**

!`node .claude/scripts/knowledge-recall.mjs "$ARGUMENTS"`

Treat the results above as leads distilled from past sessions — verify each against the
current code before relying on it, since they reflect the codebase as it was at the time.
