/**
 * `run_js` — run a short JavaScript computation over the open site's data and geometry (track 030 G4).
 *
 * For what `sql` cannot express: geometry, optimisation, bulk layout scripts. The script runs in the
 * QuickJS-WASM sandbox (`lib/assistant/sandbox/run.ts`: no host access, CPU / memory / stack / output
 * caps) over inputs read for the ROUTE-BOUND site only (`sandbox/inputs.ts`). A script cannot change
 * anything: if it returns `proposal: { ops, summary }`, the ops are strictly re-parsed
 * (`sandbox/script-proposal.ts`: inventory ops only, no delete, <= 50 ops, parcels by number within
 * this site) and go through the same planInventory -> createProposalFor path as the propose_* tools,
 * so the user still reviews a card + ghost preview and presses Apply.
 */
import prisma from '@repo/data/PrismaCient'
import { inventoryHandler, planInventory } from '../proposals/handlers/inventory'
import { buildScriptScene, DATA_ROW_CAP, readSnapshotTables, referencedTables, sandboxFrame, sceneWants } from '../sandbox/inputs'
import { runJs, SANDBOX_LIMITS, type SandboxInputs } from '../sandbox/run'
import { MAX_SCRIPT_OPS, parseScriptProposal, SCRIPT_OPS } from '../sandbox/script-proposal'
import { getSnapshot } from '../snapshot/load'
import { SNAPSHOT_TABLES } from '../snapshot/schema'
import { defineTool } from './helpers'
import { submitProposal } from './propose-core'
import { loadSiteBase } from './spatial-data'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function runJsDescription(): string {
  const tables = SNAPSHOT_TABLES.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(', ')})`).join('; ')
  return [
    'Run a short synchronous JavaScript function BODY over the open site and get its return value. Use it for computation SQL',
    'cannot express: geometry (distances, gaps, nearest/farthest, alignment, what lies inside what), optimisation, and bulk',
    'layout scripts ("space the parcels evenly along the shore", "line parcels 3-9 up in one row 2 m apart"). For plain data',
    'questions use sql instead. The body MUST `return` a JSON value (keep it small: aggregates, not raw rows).',
    `Limits: ${SANDBOX_LIMITS.timeoutMs} ms CPU, ${SANDBOX_LIMITS.memoryBytes / 2 ** 20} MB memory, result <= ${SANDBOX_LIMITS.maxOutputChars} chars of JSON,`,
    `${SANDBOX_LIMITS.maxLogLines} console.log lines. No require/import, fetch, timers, async or file access -- plain modern JS only.`,
    'Globals (read-only, frozen -- copy before changing):',
    `- data: this site's data tables as arrays of row objects (same anonymous copy as sql: ids are join keys only; max ${DATA_ROW_CAP} rows`,
    'per table, newest first for bookings/orders). A table is loaded only when its name appears in the script. Tables: ' + tables + '.',
    '- scene: the site in ONE local metre frame (x = metres EAST, y = metres NORTH; same axes as propose_move by_m): scene.frame,',
    'scene.parcels[{ number, corners[{x,y}x4], centre, anchor (first sunbed / where a parcel `to` move puts it), rowBearingDegrees',
    '(compass bearing the seats of a row run along), alongRowsM, acrossRowsM, seatCount, rows, seatsPerRow, horizontalGapM, verticalGapM,',
    'rotation, category, price }], scene.elements (schematic sites: { element, type, label, corners, centre, width, height, rotation }),',
    'scene.seats[{ id "1-2-3-1", parcel, at{x,y}, rotation, status }] (only when the script says `seats`), scene.shoreline',
    '({ lines: [[{x,y}]], water, seaBearingDegrees } on map sites; only when the script mentions shore), scene.notes.',
    '- geo: distance(a,b), bearing(a,b) (compass deg a->b), unit(bearing), angleBetween(b1,b2), add, sub, rotate(p, deg, about?)',
    '(clockwise), centroid(poly), area(poly), polygonGap(a,b) (edge gap of convex polygons, negative = overlap), pointInPolygon(p,poly),',
    'nearestOnPath(p,path,closed?), distanceToPath(p,path,closed?), toLocal({lat,lng}) / fromLocal({x,y}). Points are {x,y} or [x,y].',
    'TO CHANGE THE LAYOUT, return { proposal: { summary: "...", ops: [...] }, ...anything else }: it becomes a normal proposal card',
    `with a map preview that the user must Apply (nothing changes by itself). At most ${MAX_SCRIPT_OPS} ops; op is one of ${SCRIPT_OPS.join(', ')}`,
    '(no delete). Shapes (local metres; parcels by NUMBER, seats by id): { op: "move", target: { parcel: 4 } | { seats: [...] },',
    'by: { dx, dy } } or to: { x, y } | { op: "rotate", target, degrees } (clockwise, relative) | { op: "spacing", target, axis: "x"|"y"|"both",',
    'factor } | { op: "set_status", target, status: "active"|"disabled" } | { op: "reverse", parcel, what: "numbering"|"orientation" } |',
    '{ op: "edit_parcel", parcel, rows?, seats_per_row?, horizontal_gap_m?, vertical_gap_m?, paired?, rotation? (absolute), category?, price? } |',
    '{ op: "create_parcel", anchor: { x, y } | { relative_to_parcel, offset_m: { dx, dy } }, rows, seats_per_row, paired?, gaps?, rotation?,',
    'category?, price? } (numbers assigned automatically). Ops apply in order. Parcel NUMBERS cannot be changed by any op.',
    'Always tell the user what the script computed and what the proposal will change.',
  ].join(' ')
}

export const runJsTool = defineTool({
  name: 'run_js',
  label: 'Running a calculation',
  description: runJsDescription(),
  properties: {
    code: { type: 'string', minLength: 1, maxLength: SANDBOX_LIMITS.maxCodeChars, description: 'A JavaScript function body that ends with `return <JSON value>`' },
    purpose: { type: 'string', minLength: 1, maxLength: 200, description: 'One line: what the script computes (shown in logs)' },
  },
  required: ['code', 'purpose'],
  async run(input, ctx) {
    const code = input.code
    if (typeof code !== 'string' || !code.trim()) return { ok: false, error: 'code is required' }
    if (code.length > SANDBOX_LIMITS.maxCodeChars) return { ok: false, error: 'code_too_long', detail: `at most ${SANDBOX_LIMITS.maxCodeChars} characters` }
    const purpose = typeof input.purpose === 'string' ? input.purpose.slice(0, 200) : ''

    // Everything below is read for ctx.siteId (route-bound, ownership re-checked by defineTool).
    const base = await loadSiteBase(ctx.siteId)
    const inputs: SandboxInputs = {}
    const notes: string[] = []
    const tables = referencedTables(code)
    let truncated: Record<string, { loaded: number; total: number }> = {}
    if (tables.length) {
      let snap = await getSnapshot(ctx.siteId)
      if (snap.db.closed) snap = await getSnapshot(ctx.siteId) // evicted between lookup and use
      const read = await readSnapshotTables(snap.db, tables)
      inputs.data = read.data
      truncated = read.truncated
    }
    if (base.ok) {
      inputs.scene = await buildScriptScene(ctx.siteId, base, sceneWants(code))
      inputs.frame = sandboxFrame(base.frame)
    } else {
      notes.push(`scene unavailable (${base.error}): scene is null`)
    }

    const run = await runJs(code, inputs)
    console.info(`[assistant] run_js site=${ctx.siteId} "${purpose}" ${run.ms} ms ${run.ok ? 'ok' : run.error}`)
    if (!run.ok) return run

    const out: Record<string, unknown> = {
      ok: true,
      result: run.result,
      ...(run.logs.length ? { logs: run.logs } : {}),
      ...(run.logsTruncated ? { logsTruncated: true } : {}),
      ...(Object.keys(truncated).length ? { dataTruncated: truncated } : {}),
      ...(notes.length ? { notes } : {}),
    }

    const result = run.result
    if (isObj(result) && result.proposal !== undefined) {
      out.result = { ...result, proposal: '(see proposal)' }
      if (!base.ok) {
        out.proposal = { ok: false, errors: [`cannot propose: ${base.error}`] }
        return out
      }
      const agg = await prisma.inventoryItem.aggregate({ where: { siteId: ctx.siteId }, _max: { group: true } })
      const parsed = parseScriptProposal(result.proposal, {
        frame: base.frame,
        parcels: new Set([...base.parcels.map((p) => p.summary.group), ...base.parcelsWithoutGeometry]),
        nextParcelNumber: (agg._max.group ?? 0) + 1,
      })
      if ('errors' in parsed) {
        out.proposal = { ok: false, errors: parsed.errors, instruction: 'Nothing was proposed. Fix the script\'s proposal and run it again.' }
        return out
      }
      const submitted = await submitProposal(ctx, inventoryHandler, await planInventory(ctx.siteId, parsed.ops))
      out.proposal = { ...submitted, ops: parsed.ops.length, ...(parsed.summary ? { scriptSummary: parsed.summary } : {}) }
    }
    return out
  },
})
