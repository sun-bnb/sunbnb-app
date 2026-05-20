#!/usr/bin/env node
// predev hook — make the local dev environment ready before `npm run dev`.
// FAST + GRACEFUL: starts/render what it safely can, warns otherwise, and NEVER blocks
// the dev start (always exits 0). Runs from the app dir (npm sets cwd there for predev).

import { execSync, spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const CWD = process.cwd();
const APP = basename(CWD);
const REPO = (() => {
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return join(CWD, '..', '..'); }
})();
const APP_DB = 'sunbnb-postgres';
const warn = (m) => console.warn(`[dev-env] ${m}`);
const dockerUp = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const state = (n) => {
  const r = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', n], { encoding: 'utf8' });
  return r.status !== 0 ? 'absent' : (r.stdout.trim() === 'true' ? 'running' : 'stopped');
};

if (!dockerUp()) { warn('Docker not running — start Docker Desktop. (skipping dev-env checks)'); process.exit(0); }

// 1. App database
const st = state(APP_DB);
if (st === 'stopped') { warn(`starting ${APP_DB}…`); spawnSync('docker', ['start', APP_DB], { stdio: 'ignore' }); }
else if (st === 'absent') warn(`${APP_DB} container missing — run scripts/bootstrap.sh to provision it.`);

// 2. Env files — render any missing/empty .env.local from the master (quietly when nothing to do)
const r = spawnSync('node', [join(REPO, 'scripts', 'apply-dev-env.mjs')], { encoding: 'utf8' });
const notable = (r.stdout || '').split('\n').filter((l) => /wrote|error|No master/i.test(l));
if (notable.length) console.log(notable.join('\n'));
if (r.status !== 0) warn('could not apply dev-env — is dev-env.local present?');

// 3. HTTPS certs (partner/user serve over https via server.js)
if (APP === 'partner' || APP === 'user') {
  const cdir = join(CWD, 'certificates');
  const hasCerts = existsSync(cdir) && readdirSync(cdir).some((f) => /\.(pem|crt|key)$/.test(f));
  if (!hasCerts) warn(`no HTTPS certs in ${APP}/certificates — generate with mkcert (see CLAUDE.md › Local setup).`);
}

process.exit(0);
