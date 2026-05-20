#!/usr/bin/env node
// SessionStart hook — ensure the knowledge-store container is running so the SessionEnd
// ingest can write. Silent on success (no stdout — SessionStart stdout is added to the
// session context), graceful otherwise. Always exits 0; never blocks a session.

import { spawnSync } from 'child_process';

const C = 'sunbnb-knowledge-postgres';

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) process.exit(0); // Docker down → silent

const r = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', C], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(`[knowledge] container ${C} missing — provision per .claude/scripts/knowledge-schema.sql`);
  process.exit(0);
}
if (r.stdout.trim() !== 'true') spawnSync('docker', ['start', C], { stdio: 'ignore' });
process.exit(0);
