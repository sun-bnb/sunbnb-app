#!/usr/bin/env node
// detect-drift.mjs — compatibility shim. Superseded by context-health.mjs (track 031), which
// covers wiki + canonical + playbooks + tracks + agents with the same CLI. Delete after one
// release once nothing references this path.
await import('./context-health.mjs');
