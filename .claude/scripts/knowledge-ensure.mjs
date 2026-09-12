#!/usr/bin/env node
// SessionStart hook — ensure Docker and the knowledge-store container are running so
// the SessionEnd ingest can write. Silent on success (no stdout — SessionStart stdout
// is added to the session context), graceful otherwise. Always exits 0 and never
// blocks a session: when the Docker daemon is down it launches Docker Desktop and
// hands the wait to a DETACHED copy of itself (`--wait`), which starts the container
// once the daemon answers. Without this, a laptop reboot silently disabled ingestion
// for every session until Docker was opened by hand.

import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const C = 'sunbnb-knowledge-postgres';
const WAIT_MS = 120_000;   // Docker Desktop cold start is typically 15–40 s
const POLL_MS = 2_000;

const dockerUp = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

function ensureContainer() {
  const r = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', C], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`[knowledge] container ${C} missing — provision per .claude/scripts/knowledge-schema.sql`);
    return;
  }
  if (r.stdout.trim() !== 'true') spawnSync('docker', ['start', C], { stdio: 'ignore' });
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function waitForDaemon() {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (dockerUp()) { ensureContainer(); return; }
    await sleep(POLL_MS);
  }
  // Detached: nobody sees this, but it costs nothing and helps if run by hand.
  console.error(`[knowledge] Docker daemon did not come up within ${WAIT_MS / 1000}s`);
}

if (process.argv.includes('--wait')) {
  await waitForDaemon();
  process.exit(0);
}

if (dockerUp()) {
  ensureContainer();
  process.exit(0);
}

if (process.platform !== 'darwin') process.exit(0); // no known launcher → stay silent

// `-g` keeps Docker Desktop from stealing focus from the terminal.
const launched = spawnSync('open', ['-g', '-a', 'Docker'], { stdio: 'ignore' }).status === 0;
if (!launched) {
  console.error('[knowledge] Docker daemon is down and Docker Desktop could not be launched — ingestion is off until Docker runs');
  process.exit(0);
}
const waiter = spawn(process.execPath, [fileURLToPath(import.meta.url), '--wait'], {
  detached: true,
  stdio: 'ignore',
});
waiter.unref();
console.error('[knowledge] Docker daemon was down — launched Docker Desktop; the knowledge container starts once it is up');
process.exit(0);
