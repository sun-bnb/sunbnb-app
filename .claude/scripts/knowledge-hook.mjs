#!/usr/bin/env node
// SessionEnd hook entry. Reads the hook payload on stdin, spawns the ingest worker
// DETACHED, and exits immediately so a slow distill/embed never blocks the CLI.
// Wire in .claude/settings.local.json:
//   "hooks": { "SessionEnd": [ { "hooks": [ { "type": "command",
//     "command": "node \"$CLAUDE_PROJECT_DIR/.claude/scripts/knowledge-hook.mjs\"" } ] } ] }

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { /* ignore */ }
  const transcript = payload.transcript_path;
  const sessionId = payload.session_id || '';
  if (!transcript) process.exit(0);

  const script = join(dirname(fileURLToPath(import.meta.url)), 'knowledge-ingest.mjs');
  const child = spawn('node', [script, '--session', transcript, '--session-id', sessionId], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  process.exit(0);
});
