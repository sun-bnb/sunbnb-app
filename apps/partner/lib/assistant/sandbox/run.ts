/**
 * `runJs` — run model-written JavaScript in a QuickJS-WASM sandbox (track 030 G4).
 *
 * WHY QuickJS and not Node `vm`: `vm` is not a security boundary (prototype walks reach the host
 * realm). QuickJS is a separate JS engine compiled to WebAssembly: the script's heap is a WASM linear
 * memory, and the only things it can touch are what we put into its global object — JSON inputs and a
 * pure-JS `geo` library. No `require`, `process`, `fetch`, timers, fs or network exist in there, and
 * no host function is exposed (so there is no host-side argument validation to get wrong).
 *
 * Limits (enforced by the engine, not by convention):
 *  - CPU: an interrupt handler with a wall-clock deadline (`timeoutMs`), checked by QuickJS on
 *    every backward branch / call AND inside the regex engine (catastrophic backtracking stops too);
 *  - memory: `setMemoryLimit` (QuickJS malloc cap) -> "out of memory";
 *  - stack: `setMaxStackSize` -> "stack overflow". Some native recursions (JSON.stringify / String()
 *    of a deeply nested value) do not check it and overflow the HOST stack instead; V8 turns that into
 *    a RangeError we catch. The WASM instance may be inconsistent afterwards, which is why every run
 *    gets a FRESH module instance (~2 ms) and a poisoned one is dropped without disposal;
 *  - output: result <= `maxOutputChars` of JSON, logs <= `maxLogLines` / `maxLogChars`.
 * Inputs are injected as one JSON string, parsed and deep-frozen inside the sandbox.
 */
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSRuntime } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-singlefile-cjs-release-sync'
import { GEO_LIB_SOURCE } from './geo-lib'

export const SANDBOX_LIMITS = {
  /** QuickJS heap cap. */
  memoryBytes: 64 * 1024 * 1024,
  /** QuickJS stack cap (kept well under Node's own ~1 MB so ordinary recursion fails INSIDE the sandbox). */
  stackBytes: 256 * 1024,
  /** Wall-clock budget for the script itself. */
  timeoutMs: 1500,
  /** Budget for parsing + freezing the inputs (before the script runs). */
  setupTimeoutMs: 3000,
  maxCodeChars: 20_000,
  /** Serialized inputs; the tool's row caps keep real sites far below this. */
  maxInputChars: 12_000_000,
  maxOutputChars: 30_000,
  maxLogLines: 50,
  maxLogChars: 4_000,
} as const

export type SandboxLimits = Record<keyof typeof SANDBOX_LIMITS, number>

/** Frame constants for the in-sandbox `geo.toLocal` / `geo.fromLocal`. */
export type SandboxFrame = { mode: 'geo'; origin: { lat: number; lng: number }; perLng: number; mPerDeg: number } | { mode: 'schematic' }

export interface SandboxInputs {
  data?: Record<string, unknown>
  scene?: unknown
  frame?: SandboxFrame
}

export type RunJsError =
  | 'code_too_long' | 'inputs_too_large' | 'syntax_error' | 'script_error' | 'no_return' | 'async_not_supported'
  | 'result_not_serializable' | 'output_too_large' | 'timeout' | 'memory_limit' | 'stack_overflow' | 'sandbox_failed'

export type RunJsResult =
  | { ok: true; result: unknown; logs: string[]; logsTruncated?: boolean; ms: number }
  | { ok: false; error: RunJsError; detail?: string; logs: string[]; logsTruncated?: boolean; ms: number }

/**
 * Setup script: runs once per sandbox, defines the frozen globals and a one-shot `__run`.
 * `__IN` (the input JSON string) and `__run` delete themselves, so the script sees only
 * `data`, `scene`, `geo`, `console` beyond the ECMAScript built-ins.
 */
const SETUP = (limits: SandboxLimits) => `
(function () {
  'use strict';
  ${GEO_LIB_SOURCE}
  var IN = globalThis.__IN;
  delete globalThis.__IN;
  var stringify = JSON.stringify, parse = JSON.parse, ObjectFreeze = Object.freeze, isFrozen = Object.isFrozen;
  function deepFreeze(v) {
    if (v && typeof v === 'object' && !isFrozen(v)) { ObjectFreeze(v); for (var k in v) deepFreeze(v[k]); }
    return v;
  }
  var input = parse(IN);
  IN = null;
  var logs = [], logChars = 0, dropped = 0;
  function fmt(a) {
    if (typeof a === 'string') return a;
    try { var s = stringify(a); return s === undefined ? String(a) : s; } catch (e) { return String(a); }
  }
  function log() {
    var line = Array.prototype.map.call(arguments, fmt).join(' ');
    if (logs.length >= ${limits.maxLogLines} || logChars + line.length > ${limits.maxLogChars}) { dropped++; return; }
    logs.push(line); logChars += line.length;
  }
  function def(name, value) { Object.defineProperty(globalThis, name, { value: value, writable: false, configurable: false, enumerable: true }); }
  def('data', deepFreeze(input.data || {}));
  def('scene', deepFreeze(input.scene === undefined ? null : input.scene));
  def('geo', deepFreeze(__makeGeo(deepFreeze(input.frame || { mode: 'schematic' }))));
  def('console', ObjectFreeze({ log: log, info: log, warn: log, error: log, debug: log }));
  input = null;
  Object.defineProperty(globalThis, '__run', { configurable: true, writable: false, enumerable: false, value: function (src) {
    delete globalThis.__run;
    var out;
    try {
      var fn;
      try { fn = Function('"use strict";\\n' + src); }
      catch (e) { return stringify({ ok: false, error: 'syntax_error', detail: String(e && e.message || e), logs: logs }); }
      var value = fn();
      if (value === undefined) out = { ok: false, error: 'no_return', detail: 'The script must end with a return statement that returns a JSON value.' };
      else if (value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function') out = { ok: false, error: 'async_not_supported', detail: 'Scripts are synchronous: no async/await or Promises.' };
      else out = { ok: true, result: value };
    } catch (e) {
      out = { ok: false, error: 'script_error', detail: e && e.message ? (e.name || 'Error') + ': ' + e.message + (e.stack ? '\\n' + String(e.stack).split('\\n').slice(0, 4).join('\\n') : '') : String(e) };
    }
    out.logs = logs;
    if (dropped) out.logsTruncated = true;
    try { var s = stringify(out); if (typeof s === 'string') return s; }
    catch (e) { return stringify({ ok: false, error: 'result_not_serializable', detail: String(e && e.message || e), logs: logs, logsTruncated: dropped > 0 }); }
    return stringify({ ok: false, error: 'result_not_serializable', detail: 'The returned value is not JSON.', logs: logs });
  } });
})();
`

/** QuickJS error message -> our error code. */
function classify(message: string): { error: RunJsError; detail: string } {
  if (/interrupted/i.test(message)) return { error: 'timeout', detail: 'The script ran longer than the time limit and was stopped. Simplify it (fewer nested loops).' }
  if (/out of memory/i.test(message)) return { error: 'memory_limit', detail: 'The script used more memory than allowed and was stopped.' }
  if (/stack overflow|call stack/i.test(message)) return { error: 'stack_overflow', detail: 'Recursion or nesting too deep.' }
  return { error: 'script_error', detail: message.slice(0, 500) }
}

const errorMessage = (vm: QuickJSContext, handle: Parameters<QuickJSContext['dump']>[0]): string => {
  try {
    const d = vm.dump(handle) as unknown
    if (d && typeof d === 'object' && 'message' in d) return String((d as { message: unknown }).message)
    return String(d)
  } catch {
    return 'unknown error'
  }
}

/**
 * Run `code` (a function BODY that must `return` a JSON value) against `inputs`.
 * Never throws: every failure is a `{ ok: false, error }`.
 */
export async function runJs(code: string, inputs: SandboxInputs, limitsOverride: Partial<SandboxLimits> = {}): Promise<RunJsResult> {
  const limits: SandboxLimits = { ...SANDBOX_LIMITS, ...limitsOverride }
  const started = performance.now()
  const ms = () => Math.round(performance.now() - started)
  if (typeof code !== 'string' || code.length > limits.maxCodeChars) {
    return { ok: false, error: 'code_too_long', detail: `at most ${limits.maxCodeChars} characters`, logs: [], ms: ms() }
  }
  let inputJson: string
  try {
    inputJson = JSON.stringify({ data: inputs.data ?? {}, scene: inputs.scene ?? null, frame: inputs.frame ?? { mode: 'schematic' } })
  } catch {
    return { ok: false, error: 'sandbox_failed', detail: 'inputs not serializable', logs: [], ms: ms() }
  }
  if (inputJson.length > limits.maxInputChars) return { ok: false, error: 'inputs_too_large', logs: [], ms: ms() }

  let rt: QuickJSRuntime | null = null
  let vm: QuickJSContext | null = null
  let poisoned = false
  try {
    // A fresh WASM instance per run: nothing survives between scripts, and a run that blew the
    // host stack (see header) cannot affect the next one.
    const mod = await newQuickJSWASMModuleFromVariant(variant)
    rt = mod.newRuntime()
    rt.setMemoryLimit(limits.memoryBytes)
    rt.setMaxStackSize(limits.stackBytes)
    vm = rt.newContext()

    const inHandle = vm.newString(inputJson)
    vm.setProp(vm.global, '__IN', inHandle)
    inHandle.dispose()

    rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.setupTimeoutMs))
    const setup = vm.evalCode(SETUP(limits), 'setup.js')
    if (setup.error) {
      const msg = errorMessage(vm, setup.error)
      setup.error.dispose()
      const c = classify(msg)
      return { ok: false, error: c.error === 'script_error' ? 'sandbox_failed' : c.error, detail: `while loading inputs: ${c.detail}`, logs: [], ms: ms() }
    }
    setup.value.dispose()

    rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.timeoutMs))
    const res = vm.evalCode(`__run(${JSON.stringify(code)})`, 'script.js')
    if (res.error) {
      // Interrupts / OOM are uncatchable inside the sandbox, so they surface here (logs are lost).
      const msg = errorMessage(vm, res.error)
      res.error.dispose()
      return { ok: false, ...classify(msg), logs: [], ms: ms() }
    }
    const kind = vm.typeof(res.value)
    const out = kind === 'string' ? vm.getString(res.value) : null
    res.value.dispose()
    if (out == null) return { ok: false, error: 'sandbox_failed', detail: 'no output', logs: [], ms: ms() }
    // Bound what the host parses; the real cap is checked on the result below.
    if (out.length > limits.maxOutputChars + limits.maxLogChars * 2 + 10_000) {
      return { ok: false, error: 'output_too_large', detail: `The returned value is larger than ${limits.maxOutputChars} characters of JSON. Return an aggregate or fewer rows.`, logs: [], ms: ms() }
    }
    const parsed = JSON.parse(out) as { ok: boolean; result?: unknown; error?: RunJsError; detail?: string; logs?: unknown; logsTruncated?: boolean }
    const logs = Array.isArray(parsed.logs) ? parsed.logs.filter((l): l is string => typeof l === 'string') : []
    const extra = parsed.logsTruncated ? { logsTruncated: true } : {}
    if (!parsed.ok) {
      const detail = parsed.detail ? String(parsed.detail).slice(0, 1000) : undefined
      // A caught engine limit (OOM / stack) reaches the script's own catch: report it as the limit.
      const limit = parsed.error === 'script_error' && detail?.startsWith('InternalError: ') ? classify(detail) : null
      if (limit && limit.error !== 'script_error') return { ok: false, ...limit, logs, ...extra, ms: ms() }
      return { ok: false, error: parsed.error ?? 'script_error', ...(detail ? { detail } : {}), logs, ...extra, ms: ms() }
    }
    if (JSON.stringify(parsed.result).length > limits.maxOutputChars) {
      return { ok: false, error: 'output_too_large', detail: `The returned value is larger than ${limits.maxOutputChars} characters of JSON. Return an aggregate or fewer rows.`, logs, ...extra, ms: ms() }
    }
    return { ok: true, result: parsed.result, logs, ...extra, ms: ms() }
  } catch (err) {
    poisoned = true
    const msg = err instanceof Error ? err.message : String(err)
    if (err instanceof RangeError || /call stack/i.test(msg)) return { ok: false, error: 'stack_overflow', detail: 'Recursion or nesting too deep.', logs: [], ms: ms() }
    console.error('[assistant] run_js sandbox failure', err)
    return { ok: false, error: 'sandbox_failed', detail: msg.slice(0, 300), logs: [], ms: ms() }
  } finally {
    if (!poisoned) {
      try {
        vm?.dispose()
        rt?.dispose()
      } catch {
        // A leak-check assertion on dispose aborts only this (discarded) WASM instance.
      }
    }
  }
}
