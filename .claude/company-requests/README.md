# Company requests: product backlog from the company repo

Product changes asked for by Sunbnb's company side (`~/projects/sunbnb/sunbnb-company`: sales, pricing,
compliance wording, operator feedback). Each request is one file, `NNN-slug.md`, written as a self-contained
prompt: why, current behaviour with file paths, the change, acceptance criteria, out of scope, report back.

Who writes here: the company's **engineer** agent (Principal Software Engineer), and Claude in a founder session.
The engineer works in its own clone (`../sunbnb-app-engineer`, remote `app` = this checkout) on `co/CR-NNN-slug`
branches, only on requests the founder approved. It commits; push, promote and deploy each need a founder `release`
approval and are run from this checkout by a founder session (`.claude/rules/deploys.md` holds). No other company
agent writes to this repo.

## Frontmatter
```
id: CR-NNN
title: …
status: new | accepted | in-progress | done | declined
priority: 1-5 (1 = urgent)
company_ref: the company-side ids it rests on (M-n, T-n, A-n)
created: YYYY-MM-DD
track: (filled by the app session when a track takes it)
outcome: (filled when done or declined: commit, deploy, or why not)
```

## How the app session uses it
1. At session start, list requests with `status: new` and mention them to the founder.
2. Before acting, re-verify every claim about the code; the request was written from a read-only look and
   may be stale. If the code contradicts it, stop and say so.
3. Small copy or config changes: do them directly. Anything multi-session: open or extend a track
   (`/context-loop:track`) and link it in `track:`.
4. Update `status` and `outcome` as you go, and commit the file with the work.
5. The founder decides priority conflicts with existing tracks.
