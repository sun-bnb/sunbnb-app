#!/usr/bin/env node
// knowledge-recall.mjs — cross-layer semantic recall over the knowledge store. PULL-ONLY:
// invoked by an agent at task start or via /recall, never auto-injected.
//
//   node knowledge-recall.mjs "query" [--surface <agent>] [--layer wiki|playbook|track|episodic|curated|all]
//                             [--k 8] [--kc 4] [--type T] [--source S] [--since DATE]
//                             [--recency 0.2] [--halflife 90] [--boost 0.05] [--json]
//   node knowledge-recall.mjs --credit 123,456            # these hits helped: hits+1, last_hit, raw→verified
//   node knowledge-recall.mjs --candidates <agent> [--limit 12]   # episodic→curated promotion candidates
//
// Results come back grouped by TRUST TIER (track 031): wiki (canon, promoted) → playbook
// (curated, verified) → track (intent) → episodic (raw past sessions). --surface <agent>
// keeps only that agent's playbook among the playbook tier (the other tiers are shared).
// --k bounds the episodic tier; --kc bounds each curated tier.

import pg from 'pg';
import { join } from 'path';
import { loadConfig, embedTexts, toVec } from './knowledge-ingest.mjs';
import { repoRoot, loadBudgets } from './context-config.mjs';

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const name = args[i].slice(2);
    const next = args[i + 1];
    if (name === 'json' || name === 'dry-run') { flags[name] = true; continue; }
    flags[name] = next !== undefined && !next.startsWith('--') ? (i++, next) : true;
  } else positional.push(args[i]);
}
const query = positional.join(' ').trim();
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const json = !!flags.json;

const REPO_ROOT = repoRoot();
const BUDGETS = loadBudgets(REPO_ROOT);

const TIER_ORDER = ['wiki', 'playbook', 'track', 'episodic'];
const TIER_LABEL = {
  wiki: 'CANON — wiki (promoted; trust it, cite the page)',
  playbook: 'CURATED — playbook (verified; apply, then open the entry by heading if needed)',
  track: 'INTENT — track resume-here (where that effort stands)',
  episodic: 'EPISODIC — past sessions (raw leads; verify against current code before relying)',
};
const tierOf = (source) => source === 'wiki' ? 'wiki' : source === 'track' ? 'track' : String(source).startsWith('playbook:') ? 'playbook' : 'episodic';
const tierWhere = {
  wiki: `source = 'wiki'`,
  playbook: `source LIKE 'playbook:%'`,
  track: `source = 'track'`,
  episodic: `source <> 'wiki' AND source <> 'track' AND source NOT LIKE 'playbook:%'`,
};

const cfg = loadConfig();
const client = new pg.Client({ connectionString: cfg.dbUrl });
await client.connect();
try {
  if (flags.credit) await credit(String(flags.credit));
  else if (flags.candidates) await candidates(String(flags.candidates), parseInt(flags.limit || '12', 10) || 12);
  else if (query) await recall(query);
  else {
    console.error('usage: knowledge-recall.mjs "query" [--surface agent] [--layer L] [--k N] [--kc N] [--type T] [--source S] [--since DATE] [--recency λ] [--halflife D] [--boost B] [--json]\n       knowledge-recall.mjs --credit <id,id,…>\n       knowledge-recall.mjs --candidates <agent> [--limit N]');
    process.exit(2);
  }
} finally { await client.end(); }

// ---------------------------------------------------------------------------------------
async function recall(q) {
  const k = Math.min(Math.max(parseInt(flags.k || '8', 10) || 8, 1), 50);
  const kc = Math.min(Math.max(parseInt(flags.kc || '4', 10) || 4, 0), 20);
  // Recency-decay re-rank: final = (1-λ)·semantic + λ·0.5^(age/halflife) + status boost.
  // λ=0.2 / 90 d calibrated on this store (see git history); boost lifts verified (+b) and
  // promoted (+2b) records so credited/curated knowledge edges ahead of an equally-similar raw one.
  const recencyWeight = Math.min(1, Math.max(0, num(flags.recency ?? process.env.KNOWLEDGE_RECENCY_WEIGHT, 0.2)));
  const halfLifeDays = Math.max(1, num(flags.halflife ?? process.env.KNOWLEDGE_RECENCY_HALFLIFE_DAYS, 90));
  const boost = Math.max(0, num(flags.boost ?? process.env.KNOWLEDGE_STATUS_BOOST, 0.05));
  const layer = String(flags.layer || 'all');
  const tiers = layer === 'all' ? TIER_ORDER : layer === 'curated' ? ['wiki', 'playbook', 'track'] : TIER_ORDER.includes(layer) ? [layer] : null;
  if (!tiers) { console.error(`unknown --layer ${layer}`); process.exit(2); }

  const [qvec] = await embedTexts([q], 'query', cfg);
  const now = Date.now(), DAY = 86_400_000;
  const score = (r) => {
    const semantic = Number(r.score);
    const t = r.ts instanceof Date ? r.ts.getTime() : Date.parse(r.ts);
    const ageDays = Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : null;
    const recency = ageDays === null ? 0.5 : Math.pow(0.5, ageDays / halfLifeDays);
    const statusBoost = r.status === 'promoted' ? 2 * boost : r.status === 'verified' ? boost : 0;
    const final = (recencyWeight > 0 ? (1 - recencyWeight) * semantic + recencyWeight * recency : semantic) + statusBoost;
    return { ...r, semantic, recency, final };
  };

  const out = {};
  for (const tier of tiers) {
    const limit = tier === 'episodic' ? k : kc;
    if (!limit) continue;
    const where = ['embedding IS NOT NULL', tierWhere[tier]];
    const params = [toVec(qvec)];
    if (tier === 'playbook' && flags.surface) { params.push(`playbook:${flags.surface}`); where.push(`source = $${params.length}`); }
    // agent task-start mode: domain pages only — the maintenance workflows (wiki/context) are
    // meta and would outrank entity/flow/subsystem pages on generic phrasing
    if (tier === 'wiki' && flags.surface) where.push(`provenance NOT LIKE '%/workflows/%'`);
    if (flags.type) { params.push(flags.type); where.push(`type = $${params.length}`); }
    if (flags.source) { params.push(flags.source); where.push(`source = $${params.length}`); }
    if (flags.since) { params.push(flags.since); where.push(`ts >= $${params.length}`); }
    const poolSize = recencyWeight > 0 ? Math.min(100, Math.max(limit * 5, 24)) : limit;
    const { rows } = await client.query(
      `SELECT id, source, type, status, hits, text, ts, branch, code_version, entities, files, provenance,
              1 - (embedding <=> $1::vector) AS score
       FROM knowledge_record WHERE ${where.join(' AND ')}
       ORDER BY embedding <=> $1::vector LIMIT ${poolSize}`, params);
    // curated tiers: drop weak matches so they don't pad the output
    const minSemantic = tier === 'episodic' ? 0 : 0.45;
    out[tier] = rows.map(score).filter((r) => r.semantic >= minSemantic).sort((a, b) => b.final - a.final).slice(0, limit);
  }

  if (json) { console.log(JSON.stringify({ query: q, tiers: out }, null, 2)); return; }
  const total = Object.values(out).reduce((n, a) => n + a.length, 0);
  if (!total) { console.log('No matching records. (Empty store? node .claude/scripts/knowledge-ingest.mjs --sweep; node .claude/scripts/knowledge-curated.mjs)'); return; }
  console.log(`Recall for: "${q}"${flags.surface ? `  (surface ${flags.surface})` : ''}  ·  λ=${recencyWeight} half-life ${halfLifeDays}d boost ${boost}\n`);
  for (const tier of tiers) {
    const rows = out[tier] || [];
    if (!rows.length) continue;
    console.log(`━━ ${TIER_LABEL[tier]}\n`);
    for (const r of rows) {
      const date = r.ts ? (r.ts instanceof Date ? r.ts.toISOString() : String(r.ts)).slice(0, 10) : '????-??-??';
      const sha = r.code_version ? `@${r.code_version.slice(0, 7)}` : '';
      const head = tier === 'episodic'
        ? `${r.type}  ·  ${date}  ·  ${r.branch || '?'}${sha}  ·  ${r.status}${r.hits ? ` ×${r.hits}` : ''}`
        : `${r.provenance}  ·  ${date}${r.hits ? `  ·  ×${r.hits}` : ''}`;
      console.log(`#${r.id} [${r.final.toFixed(3)}] ${head}`);
      console.log('  ' + r.text.replace(/\n/g, '\n  '));
      const meta = [];
      if (r.entities?.length) meta.push('entities: ' + r.entities.join(', '));
      if (r.files?.length) meta.push('files: ' + r.files.slice(0, 4).join(', ') + (r.files.length > 4 ? ` +${r.files.length - 4}` : ''));
      if (meta.length) console.log('  ' + meta.join('  ·  '));
      console.log('');
    }
  }
  console.log('— when a hit helped, credit it:  node .claude/scripts/knowledge-recall.mjs --credit <id,id>   (raw → verified; credits feed /groom)');
}

// ---------------------------------------------------------------------------------------
async function credit(list) {
  const ids = list.split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
  if (!ids.length) { console.error('--credit needs a comma-separated id list'); process.exit(2); }
  const { rows } = await client.query(
    `UPDATE knowledge_record
     SET hits = hits + 1, last_hit = now(), status = CASE WHEN status = 'raw' THEN 'verified' ELSE status END
     WHERE id = ANY($1::bigint[]) RETURNING id, source, status, hits`, [ids]);
  if (json) { console.log(JSON.stringify(rows)); return; }
  for (const r of rows) console.log(`credited #${r.id} (${r.source}) → ${r.status}, hits ${r.hits}`);
  const missing = ids.filter((id) => !rows.some((r) => Number(r.id) === id));
  if (missing.length) console.log(`not found: ${missing.join(', ')}`);
}

// ---------------------------------------------------------------------------------------
// Promotion candidates (episodic → curated) for /groom <agent>: raw/verified session records
// on the agent's surface that either recur (near-duplicates across ≥ 2 sessions) or were
// credited ≥ 2 times, and are NOT already near a curated record of that agent (or the wiki).
async function candidates(agent, limit) {
  const prefixes = (BUDGETS.agents?.surfaces || {})[agent];
  if (!prefixes) { console.error(`unknown agent '${agent}' — add it under budgets.agents.surfaces`); process.exit(2); }
  const patterns = prefixes.map((p) => `${p}%`);
  const { rows: pool } = await client.query(
    `SELECT id, text, ts, files, entities, hits, provenance, embedding::text AS emb
     FROM knowledge_record
     WHERE source = 'session-transcript' AND status IN ('raw','verified') AND embedding IS NOT NULL
       AND EXISTS (SELECT 1 FROM unnest(files) f WHERE f LIKE ANY($1::text[]))
     ORDER BY hits DESC, ts DESC LIMIT 600`, [patterns]);
  const NEAR = 0.12, CURATED_NEAR = 0.15;
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  const info = new Map();
  for (const r of pool) { parent.set(Number(r.id), Number(r.id)); info.set(Number(r.id), r); }
  const curatedHit = new Set();
  for (const r of pool) {
    const id = Number(r.id);
    const { rows: near } = await client.query(
      `SELECT id, provenance, embedding <=> $1::vector AS d FROM knowledge_record
       WHERE source = 'session-transcript' AND embedding IS NOT NULL AND id <> $2
       ORDER BY embedding <=> $1::vector LIMIT 8`, [r.emb, id]);
    for (const n of near) if (Number(n.d) < NEAR && n.provenance !== r.provenance) { if (!parent.has(Number(n.id))) parent.set(Number(n.id), Number(n.id)); union(id, Number(n.id)); }
    const { rows: cur } = await client.query(
      `SELECT embedding <=> $1::vector AS d FROM knowledge_record
       WHERE (source = $2 OR source = 'wiki') AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector LIMIT 1`, [r.emb, `playbook:${agent}`]);
    if (cur.length && Number(cur[0].d) < CURATED_NEAR) curatedHit.add(id);
  }
  const clusters = new Map();
  for (const r of pool) {
    const root = find(Number(r.id));
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(r);
  }
  const ranked = [...clusters.values()]
    .map((members) => {
      const sessions = new Set(members.map((m) => m.provenance)).size;
      const hits = members.reduce((n, m) => n + Number(m.hits || 0), 0);
      const rep = members.slice().sort((a, b) => (b.ts > a.ts ? 1 : -1))[0];
      const alreadyCurated = members.some((m) => curatedHit.has(Number(m.id)));
      return { rep, members, sessions, hits, alreadyCurated };
    })
    .filter((c) => !c.alreadyCurated && (c.sessions >= 2 || c.hits >= 2))
    .sort((a, b) => (b.sessions + b.hits) - (a.sessions + a.hits) || (b.rep.ts > a.rep.ts ? 1 : -1))
    .slice(0, limit);
  if (json) { console.log(JSON.stringify(ranked.map((c) => ({ ids: c.members.map((m) => Number(m.id)), sessions: c.sessions, hits: c.hits, text: c.rep.text, files: c.rep.files, entities: c.rep.entities, latest: c.rep.ts })), null, 2)); return; }
  if (!ranked.length) { console.log(`No promotion candidates for ${agent} (pool ${pool.length}).`); return; }
  console.log(`Promotion candidates for ${agent} — ${ranked.length} of ${clusters.size} clusters (pool ${pool.length} episodic records on ${prefixes.join(', ')})\n`);
  for (const c of ranked) {
    const date = c.rep.ts ? String(c.rep.ts instanceof Date ? c.rep.ts.toISOString() : c.rep.ts).slice(0, 10) : '?';
    console.log(`• ${c.sessions} session${c.sessions === 1 ? '' : 's'}${c.hits ? `, ${c.hits} credit${c.hits === 1 ? '' : 's'}` : ''}  ·  latest ${date}  ·  ids ${c.members.map((m) => '#' + m.id).join(' ')}`);
    console.log('  ' + c.rep.text.replace(/\n/g, '\n  '));
    if (c.rep.files?.length) console.log('  files: ' + c.rep.files.slice(0, 4).join(', '));
    console.log('');
  }
  console.log('— write the ones that pass the gate as playbook entries (v2 format), then: node .claude/scripts/knowledge-recall.mjs --credit <ids> marks the sources verified.');
}
