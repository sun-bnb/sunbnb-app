/**
 * The run_js sandbox (track 030 G4) against the REAL QuickJS-WASM engine: limits stop runaway
 * scripts, nothing from the host realm is reachable, and the in-sandbox `geo` library agrees with
 * the host's `lib/assistant/geo`.
 */
import { describe, it, expect } from 'vitest'
import { runJs, SANDBOX_LIMITS, type SandboxFrame } from './run'
import { bearingOf, geoFrame, toLocal, toSite, type Frame, type Pt } from '../geo/frame'
import { centroid, pointInPolygon, polygonGap, sub, hypot, nearestOnPath } from '../geo/shapes'

const ok = async (code: string, inputs = {}) => {
  const r = await runJs(code, inputs)
  if (!r.ok) throw new Error(`${r.error}: ${r.detail}`)
  return r.result
}

describe('runJs basics', () => {
  it('returns a JSON value and captures console.log', async () => {
    const r = await runJs('console.log("hi", { a: 1 }); return [1, 2, { b: "x" }]', {})
    expect(r).toMatchObject({ ok: true, result: [1, 2, { b: 'x' }], logs: ['hi {"a":1}'] })
  })

  it('requires a return, rejects promises, reports syntax and runtime errors', async () => {
    expect(await runJs('const a = 1', {})).toMatchObject({ ok: false, error: 'no_return' })
    expect(await runJs('return Promise.resolve(1)', {})).toMatchObject({ ok: false, error: 'async_not_supported' })
    expect(await runJs('return (', {})).toMatchObject({ ok: false, error: 'syntax_error' })
    const r = await runJs('console.log("before"); null.x', {})
    expect(r).toMatchObject({ ok: false, error: 'script_error', logs: ['before'] })
  })

  it('rejects a non-serializable result', async () => {
    expect(await runJs('const a = {}; a.self = a; return a', {})).toMatchObject({ ok: false, error: 'result_not_serializable' })
    expect(await runJs('return 10n', {})).toMatchObject({ ok: false, error: 'result_not_serializable' })
  })

  it('a wrapper-breaking script cannot escape the function body', async () => {
    expect(await runJs('}); return 1; (function(){', {})).toMatchObject({ ok: false, error: 'syntax_error' })
  })
})

describe('runJs limits', () => {
  it('interrupts an infinite loop at the deadline', async () => {
    const t = Date.now()
    const r = await runJs('while (true) {}', {})
    expect(r).toMatchObject({ ok: false, error: 'timeout' })
    expect(Date.now() - t).toBeGreaterThanOrEqual(SANDBOX_LIMITS.timeoutMs - 50)
    expect(Date.now() - t).toBeLessThan(SANDBOX_LIMITS.timeoutMs + 1500)
  })

  it('interrupts catastrophic regex backtracking', async () => {
    const r = await runJs('return /(a+)+$/.test("a".repeat(40) + "b")', {}, { timeoutMs: 300 })
    expect(r).toMatchObject({ ok: false, error: 'timeout' })
  })

  it('stops a memory bomb', async () => {
    expect(await runJs('const a = []; while (true) a.push(new Array(1e5).fill(1))', {})).toMatchObject({ ok: false, error: 'memory_limit' })
    expect(await runJs('return "x".repeat(2e8).length', {})).toMatchObject({ ok: false, error: 'memory_limit' })
  })

  it('stops runaway recursion, including native recursion that blows the host stack', async () => {
    expect(await runJs('function f(n) { return f(n + 1) + 1 } return f(0)', {})).toMatchObject({ ok: false, error: 'stack_overflow' })
    const deep = await runJs('let o = {}; for (let i = 0; i < 100000; i++) o = { a: o }; return JSON.stringify(o).length', {})
    expect(deep).toMatchObject({ ok: false, error: 'stack_overflow' })
    // ...and the next run is unaffected (fresh WASM instance).
    expect(await ok('return 2 + 2')).toBe(4)
  })

  it('caps the output size and the logs', async () => {
    const big = await runJs('return "x".repeat(40000)', {})
    expect(big).toMatchObject({ ok: false, error: 'output_too_large' })
    const r = await runJs('for (let i = 0; i < 500; i++) console.log("line " + i); return 1', {})
    expect(r.ok).toBe(true)
    expect(r.logs.length).toBe(SANDBOX_LIMITS.maxLogLines)
    expect(r.logsTruncated).toBe(true)
  })

  it('refuses over-long code', async () => {
    expect(await runJs(`return ${'1+'.repeat(SANDBOX_LIMITS.maxCodeChars)}1`, {})).toMatchObject({ ok: false, error: 'code_too_long' })
  })
})

describe('runJs isolation', () => {
  it('has no host capabilities', async () => {
    const r = await ok(`return {
      require: typeof require, process: typeof process, fetch: typeof fetch, setTimeout: typeof setTimeout,
      setInterval: typeof setInterval, module: typeof module, Buffer: typeof Buffer, XMLHttpRequest: typeof XMLHttpRequest,
      WebAssembly: typeof WebAssembly, std: typeof std, os: typeof os, importScripts: typeof importScripts,
      globalProcess: typeof globalThis.process, viaFunction: typeof Function('return this')().process,
      viaConstructor: ({}).constructor.constructor('return typeof process')(),
      hidden: [typeof __run, typeof __IN, typeof __makeGeo],
      globals: Object.keys(globalThis).sort(),
    }`)
    expect(r).toEqual({
      require: 'undefined', process: 'undefined', fetch: 'undefined', setTimeout: 'undefined', setInterval: 'undefined',
      module: 'undefined', Buffer: 'undefined', XMLHttpRequest: 'undefined', WebAssembly: 'undefined', std: 'undefined',
      os: 'undefined', importScripts: 'undefined', globalProcess: 'undefined', viaFunction: 'undefined', viaConstructor: 'undefined',
      hidden: ['undefined', 'undefined', 'undefined'],
      globals: ['console', 'data', 'geo', 'scene'],
    })
  })

  it('cannot import modules', async () => {
    const r = await runJs('return import("fs")', {})
    expect(r.ok).toBe(false)
  })

  it('inputs are deep-frozen copies and every run starts clean', async () => {
    const data = { seat: [{ number: 1 }] }
    const r = await ok('"use strict"; let threw = false; try { data.seat[0].number = 9 } catch (e) { threw = true } globalThis.leak = 1; return { threw, n: data.seat[0].number, frozen: Object.isFrozen(geo) }', { data })
    expect(r).toEqual({ threw: true, n: 1, frozen: true })
    expect(data.seat[0]!.number).toBe(1)
    expect(await ok('return typeof leak')).toBe('undefined')
  })
})

// ── geo helpers vs lib/assistant/geo ──────────────────────────────────────────

const square = (cx: number, cy: number, half: number, deg = 0): Pt[] => {
  const r = (deg * Math.PI) / 180
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({
    x: cx + half * (x! * Math.cos(r) + y! * Math.sin(r)),
    y: cy + half * (-x! * Math.sin(r) + y! * Math.cos(r)),
  }))
}

describe('in-sandbox geo library matches lib/assistant/geo', () => {
  const frame = geoFrame({ lat: 36.5, lng: -4.9 }) as Extract<Frame, { mode: 'geo' }>
  const sframe: SandboxFrame = { mode: 'geo', origin: frame.origin, perLng: frame.perLng, mPerDeg: 111320 }
  const A = square(0, 0, 5, 20)
  const B = square(14, 3, 4, -10)
  const C = square(3, 2, 3, 45) // overlaps A
  const L = [{ x: -20, y: 10 }, { x: 0, y: 12 }, { x: 25, y: 8 }]

  it('agrees on distances, bearings, centroids, gaps, containment and frame conversion', async () => {
    const r = (await ok(
      `const [A, B, C, L] = scene.shapes;
       return {
         dist: geo.distance(A[0], B[2]), bearing: geo.bearing(A[0], B[2]),
         centroidA: geo.centroid(A), gapAB: geo.polygonGap(A, B), gapAC: geo.polygonGap(A, C),
         inside: geo.pointInPolygon({ x: 1, y: 1 }, A), outside: geo.pointInPolygon(B[0], A),
         near: geo.nearestOnPath({ x: 3, y: 0 }, L, false),
         local: geo.toLocal({ lat: 36.501, lng: -4.899 }), site: geo.fromLocal({ x: 120, y: -40 }),
         rot: geo.rotate({ x: 0, y: 10 }, 90), area: geo.area(A),
       }`,
      { scene: { shapes: [A, B, C, L] }, frame: sframe },
    )) as Record<string, any>
    const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)
    close(r.dist, hypot(sub(B[2]!, A[0]!)))
    close(r.bearing, bearingOf(sub(B[2]!, A[0]!)))
    close(r.centroidA.x, centroid(A).x)
    close(r.centroidA.y, centroid(A).y)
    close(r.gapAB, polygonGap(A, B))
    close(r.gapAC, polygonGap(A, C))
    expect(r.gapAC).toBeLessThan(0)
    expect(r.inside).toBe(pointInPolygon({ x: 1, y: 1 }, A))
    expect(r.outside).toBe(pointInPolygon(B[0]!, A))
    const near = nearestOnPath({ x: 3, y: 0 }, L, false)
    close(r.near.x, near.x)
    close(r.near.y, near.y)
    const local = toLocal(frame, { lat: 36.501, lng: -4.899 })!
    close(r.local.x, local.x)
    close(r.local.y, local.y)
    const site = toSite(frame, { x: 120, y: -40 }) as { lat: number; lng: number }
    close(r.site.lat, site.lat)
    close(r.site.lng, site.lng)
    close(r.rot.x, 10) // north rotated 90 deg clockwise = east
    close(r.rot.y, 0)
    close(r.area, 100)
  })

  it('validates its arguments', async () => {
    expect(await runJs('return geo.distance({ x: 1 }, { x: 2, y: 2 })', {})).toMatchObject({ ok: false, error: 'script_error' })
  })
})
