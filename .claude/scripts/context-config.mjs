// Instance configuration for the context-system scripts (track 033).
//
// The scripts are the ENGINE — the same in every repo. Everything that names this repo lives in
// two instance files under .claude/context/: budgets.json (size/freshness thresholds, agent
// surfaces, version claims) and project.json (identity, the episodic store, the entity
// vocabulary). This module is the only place that resolves them, so the scripts can run from a
// plugin directory against any repo. Dependency-free on purpose: the SessionStart hooks import it.

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, basename } from 'path';

// The repo the scripts act on — never the scripts' own location. git first (worktree-aware, the
// historical behaviour), then the hook-provided project dir, then cwd.
export function repoRoot() {
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return process.env.CLAUDE_PROJECT_DIR || process.cwd(); }
}

export const contextDir = (root) => join(root, '.claude', 'context');

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

// budgets.json is required by the health check; other callers treat a missing file as "no
// budgets" and fall back to their own defaults.
export function loadBudgets(root, { required = false } = {}) {
  const p = join(contextDir(root), 'budgets.json');
  const b = readJson(p);
  if (!b && required) {
    console.error(`context: no ${p} — this repo has no context-system instance (run /context init)`);
    process.exit(2);
  }
  return b || {};
}

// project.json with engine defaults filled in. The store defaults derive from the project slug,
// so a fresh repo gets its own container/database without any configuration.
export function loadProject(root) {
  const raw = readJson(join(contextDir(root), 'project.json')) || {};
  const project = String(raw.project || basename(root)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const s = raw.store || {};
  const store = {
    container: s.container || `${project}-knowledge-postgres`,
    volume: s.volume || `${project}-knowledge-data`,
    image: s.image || 'pgvector/pgvector:pg17',
    port: s.port || 5434,
    user: s.user || 'postgres',
    password: s.password || 'knowledge',
    database: s.database || `${project.replace(/-/g, '_')}_knowledge`,
  };
  return { project, store, entities: Array.isArray(raw.entities) ? raw.entities : [] };
}

// KNOWLEDGE_DB_URL (env or .claude/.env.knowledge, loaded by the caller) overrides the derived URL.
export function storeUrl(store) {
  return process.env.KNOWLEDGE_DB_URL
    || `postgres://${store.user}:${store.password}@localhost:${store.port}/${store.database}`;
}

// Workspace patterns from package.json "workspaces" (npm/yarn) or pnpm-workspace.yaml.
// Only literal dirs and trailing `/*` globs are expanded — the shapes monorepos actually use.
export function workspacePatterns(root) {
  const pkg = readJson(join(root, 'package.json')) || {};
  let pats = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages || [];
  const pnpm = join(root, 'pnpm-workspace.yaml');
  if (!pats.length && existsSync(pnpm)) {
    pats = [...readFileSync(pnpm, 'utf8').matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1]);
  }
  return pats.filter((p) => !p.startsWith('!'));
}

export function workspaceDirs(root) {
  const out = [];
  for (const pat of workspacePatterns(root)) {
    if (pat.endsWith('/*')) {
      const base = pat.slice(0, -2);
      const dir = join(root, base);
      if (!existsSync(dir)) continue;
      for (const sub of readdirSync(dir)) {
        const p = join(dir, sub);
        if (statSync(p).isDirectory() && existsSync(join(p, 'package.json'))) out.push(`${base}/${sub}`);
      }
    } else if (!pat.includes('*') && existsSync(join(root, pat, 'package.json'))) {
      out.push(pat.replace(/\/$/, ''));
    }
  }
  return out;
}

// First path segment of every workspace pattern (e.g. apps, packages) — used to normalise
// absolute paths from other worktrees to repo-relative ones.
export function pathAnchors(root) {
  const a = new Set(workspacePatterns(root).map((p) => p.split('/')[0]).filter((s) => s && !s.includes('*')));
  return a.size ? [...a] : ['src'];
}
