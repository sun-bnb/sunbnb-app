/**
 * `editor` aspect: what the inventory map + schematic editors (and the other site tabs) can do
 * through the assistant. The operation list, descriptions and parameter lists (types, ranges, units)
 * are GENERATED from the registered `propose_*` tools' JSON schemas, so a new propose tool appears
 * here with no edit. `OP_META` adds what a schema cannot say -- preconditions, undo, QR-reprint
 * impact and the manual UI path (from knowledge/inventory.md and schematic.md) -- in ONE table; an
 * operation without an entry is still listed, flagged `documented:false`.
 */
import { siteLayoutMode } from '../proposals/inventory-sim'
import type { AssistantTool } from '../tools/helpers'
import { registeredTools } from './tool-source'
import type { InspectProvider } from './types'

type Mode = 'geo' | 'schematic'
export type Area = 'inventory' | 'layout' | 'site-tabs' | 'media'

export interface OpMeta {
  area: Area
  /** Layout modes where it works. */
  modes: Mode[]
  /** Things that must hold (the tool or Apply refuses otherwise). */
  needs: string[]
  /** 'yes' = Undo for 24 h; 'partial' = Undo works but removed rows are not restored; 'no' = permanent. */
  undoable: 'yes' | 'partial' | 'no'
  /** Does applying it change printed QR cards / seat labels? */
  qrReprint: 'no' | 'yes' | 'maybe'
  /** The same thing done by hand. */
  ui: string
  /** `explain_feature` topic id with the how-to. */
  explain?: string
}

const BOTH: Mode[] = ['geo', 'schematic']
const INV = 'Inventory tab'

/** Per-operation metadata. Keep in step with knowledge/inventory.md + schematic.md (a test checks the topics exist). */
export const OP_META: Record<string, OpMeta> = {
  propose_create_parcel: {
    area: 'inventory', modes: BOTH, undoable: 'yes', qrReprint: 'no',
    needs: ['anchor in the site frame: lat/lng on a map site, x/y metres on a schematic, or relative_to_parcel + offset_m', 'parcel number is assigned automatically (max + 1)', 'never invent coordinates'],
    ui: `${INV} > + Add Parcel, then click the map/canvas; fill the New Parcel panel`, explain: 'adding',
  },
  propose_edit_parcel: {
    area: 'inventory', modes: BOTH, undoable: 'yes', qrReprint: 'maybe',
    needs: ['parcel exists', 'shrinking is refused over booked sunbeds or sunbeds with a device', 'unpairing an existing paired parcel is not supported'],
    ui: `${INV} > select the parcel > pencil (Edit parcel config) > Apply changes`, explain: 'parcel-edit',
  },
  propose_rotate: {
    area: 'inventory', modes: BOTH, undoable: 'yes', qrReprint: 'no',
    needs: ['a target: parcel number, sunbed ids or the current selection'],
    ui: `${INV} > selection bar rotate buttons (5 deg parcel, 15 deg single bed) or the parcel panel Rotation`, explain: 'rotate-spacing',
  },
  propose_spacing: {
    area: 'inventory', modes: BOTH, undoable: 'yes', qrReprint: 'no',
    needs: ['at least 2 sunbeds in the target'],
    ui: `${INV} > select 2+ sunbeds > H / V spacing buttons (10 percent steps) or the parcel panel gaps`, explain: 'rotate-spacing',
  },
  propose_move: {
    area: 'inventory', modes: BOTH, undoable: 'yes', qrReprint: 'no',
    needs: ['exactly one of to / by_m', 'by_m comes from measure / measure_to_sea / measure_parcels, never guessed'],
    ui: `${INV} > drag a sunbed (the whole parcel follows) or click the map to move a selection`, explain: 'moving',
  },
  propose_set_status: {
    area: 'inventory', modes: BOTH, undoable: 'yes', qrReprint: 'no',
    needs: ['status active or disabled only', 'does not cancel existing reservations'],
    ui: `${INV} > single sunbed panel > Active / Disabled switch, or the parcel Visible / Hidden switch`, explain: 'statuses',
  },
  propose_reverse: {
    area: 'inventory', modes: BOTH, undoable: 'yes', qrReprint: 'maybe',
    needs: ['parcel exists', 'what = numbering (renumbers: QR cards must be reprinted) or orientation (beds turn 180 deg: no QR impact)'],
    ui: `${INV} > parcel panel > Reverse seat numbering / Reverse orientation`, explain: 'parcel-edit',
  },
  propose_delete: {
    area: 'inventory', modes: BOTH, undoable: 'no', qrReprint: 'no',
    needs: ['user must type a confirmation', 'refused when a device is mounted on the sunbeds', 'warns when reservations include them'],
    ui: `${INV} > trash icon in the selection bar, Delete sunbed, or Delete parcel`, explain: 'deleting',
  },
  propose_layout_elements: {
    area: 'layout', modes: ['schematic'], undoable: 'partial', qrReprint: 'no',
    needs: ['schematic-layout site (fails on map sites)', 'x/y = top-left corner in schematic metres', 'change or delete by element handle from list_layout_elements', 'deletions are proposed alone and cannot be undone'],
    ui: `${INV} (schematic) > drag from the palette; click an element > Edit element`, explain: 'schematic-elements',
  },
  propose_canvas_size: {
    area: 'layout', modes: ['schematic'], undoable: 'yes', qrReprint: 'no',
    needs: ['schematic-layout site', 'width and height 5 to 500 m', 'warns when items fall outside the new size'],
    ui: `${INV} (schematic) header > Width / Height fields`, explain: 'schematic-overview',
  },
  propose_layout_from_photo: {
    area: 'layout', modes: ['geo'], undoable: 'yes', qrReprint: 'no',
    needs: ['map-layout site', 'a top-down aerial photo attached by the user', 'request_photo_alignment done and confirmed first', '3 photo readings per day'],
    ui: 'No manual equivalent: attach the photo in the assistant, align it over the map, confirm', explain: 'aerial-photo',
  },
  propose_place_image: {
    area: 'media', modes: BOTH, undoable: 'yes', qrReprint: 'no',
    needs: ["an uploadId from the page context attachments", 'JPEG, PNG or WebP only', 'target cover / product / rental_item / brand_logo / brand_background / schematic_underlay (underlay: schematic sites only)'],
    ui: 'Content tab (cover), Products / Rentals tabs, Brand tab', explain: 'tab-content',
  },
  propose_site_fields: {
    area: 'site-tabs', modes: BOTH, undoable: 'yes', qrReprint: 'no',
    needs: ['only the fields to change', 'price is gross (VAT included)'],
    ui: 'General and Content tabs', explain: 'tab-general',
  },
  propose_working_hours: {
    area: 'site-tabs', modes: BOTH, undoable: 'yes', qrReprint: 'no',
    needs: ['each day listed has ALL its ranges replaced', '24 h HH:MM, close after open'],
    ui: 'General tab > Working hours', explain: 'tab-general',
  },
  propose_brand: { area: 'site-tabs', modes: BOTH, undoable: 'yes', qrReprint: 'no', needs: ['hex colours'], ui: 'Brand tab', explain: 'tab-brand' },
  propose_slug: { area: 'site-tabs', modes: BOTH, undoable: 'yes', qrReprint: 'no', needs: ['3-60 chars, lowercase letters, digits, dashes; must be free'], ui: 'Brand tab > public address', explain: 'tab-brand' },
  propose_products: {
    area: 'site-tabs', modes: BOTH, undoable: 'partial', qrReprint: 'no',
    needs: ['prices gross; ask for the VAT rate of a new product', 'removed products are not restored by Undo'], ui: 'Products tab', explain: 'tab-products',
  },
  propose_rental_items: {
    area: 'site-tabs', modes: BOTH, undoable: 'partial', qrReprint: 'no',
    needs: ['Rentals tab needs the rentals site feature (features[] has rentals)', 'removed items are not restored by Undo'], ui: 'Rentals tab', explain: 'tab-rentals',
  },
  propose_account_fields: {
    area: 'site-tabs', modes: BOTH, undoable: 'yes', qrReprint: 'no',
    needs: ['company details only; never bank/IBAN, payment provider, Stripe/KYC or Verifactu'], ui: 'Account > Company page',
  },
  request_qr_print: {
    area: 'inventory', modes: BOTH, undoable: 'yes', qrReprint: 'no',
    needs: ['changes nothing: opens the print dialog for a parcel or specific sunbeds', 'use after a proposal warned that QR cards need reprinting'],
    ui: `${INV} > Print QR Codes (whole site) or the sunbed panel QR Code button`, explain: 'seat-labels-qr',
  },
  request_photo_alignment: {
    area: 'layout', modes: ['geo'], undoable: 'yes', qrReprint: 'no',
    needs: ['map-layout site', 'step 1 of photo layout: changes nothing, opens the alignment view'], ui: 'Assistant only', explain: 'aerial-photo',
  },
  extract_schematic_from_plan: {
    area: 'layout', modes: ['schematic'], undoable: 'yes', qrReprint: 'no',
    needs: ['schematic-layout site', 'an attached drawing/plan image', 'a real-world scale (ask for one dimension if the drawing shows none)', '10 extractions per day'],
    ui: 'Assistant only', explain: 'schematic-plan-import',
  },
}

/** Tools listed in `editor` besides every `propose_*` one: assistant actions that touch the editors without being proposals. */
const NON_PROPOSE_EDITOR_TOOLS = ['request_qr_print', 'request_photo_alignment', 'extract_schematic_from_plan']

/** Things the editors do that the assistant cannot: the user does them by hand. */
export const MANUAL_ONLY: { what: string; ui: string; explain: string }[] = [
  { what: 'Switch layout mode (map vs schematic); locked once any sunbed exists', ui: 'General tab > Layout mode', explain: 'layout-mode' },
  { what: 'Pair or unpair existing beds (delete and place again, or re-apply the parcel with Pair seats)', ui: `${INV} > parcel panel`, explain: 'units-pairs' },
  { what: 'Assign loose sunbeds to a parcel / ungroup / restore grid formation', ui: `${INV} > selection bar`, explain: 'assign' },
  { what: 'Edit a single sunbed label, own price or number', ui: `${INV} > select one sunbed > Edit sunbed`, explain: 'seat-edit' },
  { what: 'Assign devices to units', ui: 'Devices page (needs the devices feature)', explain: 'devices' },
  { what: 'Print QR cards', ui: `${INV} > Print QR Codes`, explain: 'seat-labels-qr' },
]

// ─── JSON schema -> compact text ────────────────────────────────────────────

type Schema = Record<string, unknown>
const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v)

function typeOf(s: Schema, depth: number): string {
  if (Array.isArray(s.enum)) return (s.enum as unknown[]).map((v) => JSON.stringify(v)).join('|')
  const t = Array.isArray(s.type) ? (s.type as string[]).join('|') : typeof s.type === 'string' ? s.type : 'any'
  if (t === 'object' || (isObj(s.properties) && !s.type)) {
    if (depth >= 2 || !isObj(s.properties)) return 'object'
    const req = new Set(Array.isArray(s.required) ? (s.required as string[]) : [])
    return `{${Object.entries(s.properties).map(([k, v]) => `${k}${req.has(k) ? '' : '?'}: ${typeOf(isObj(v) ? v : {}, depth + 1)}`).join(', ')}}`
  }
  if (t === 'array') {
    const items = isObj(s.items) ? typeOf(s.items, depth + 1) : 'any'
    const bound = s.minItems != null || s.maxItems != null ? ` (${s.minItems ?? 0}..${s.maxItems ?? ''} items)` : ''
    return `${items}[]${bound}`
  }
  const range = s.minimum != null || s.maximum != null ? ` ${s.minimum ?? ''}..${s.maximum ?? ''}` : ''
  const len = typeof s.maxLength === 'number' ? ` <=${s.maxLength} chars` : ''
  return `${t}${range}${len}`
}

function unitOf(name: string, s: Schema): string | undefined {
  const d = typeof s.description === 'string' ? s.description : ''
  if (/(^|_)m$/.test(name) || /\bmetre|\bmeter/i.test(d)) return 'metres'
  if (/degree/i.test(d) || /^(degrees|rotation)$/.test(name)) return 'degrees'
  if (/gross|price/i.test(d) || name === 'price') return 'EUR'
  if (/percent/i.test(d) || name === 'vat') return 'percent'
  return undefined
}

export interface ParamInfo { name: string; type: string; required: boolean; unit?: string; note?: string }

export function paramsOf(tool: AssistantTool): ParamInfo[] {
  const props = isObj(tool.inputSchema.properties) ? tool.inputSchema.properties : {}
  const req = new Set(Array.isArray(tool.inputSchema.required) ? (tool.inputSchema.required as string[]) : [])
  return Object.entries(props).map(([name, raw]) => {
    const s = isObj(raw) ? raw : {}
    const unit = unitOf(name, s)
    const note = typeof s.description === 'string' ? s.description.slice(0, 160) : undefined
    return { name, type: typeOf(s, 0), required: req.has(name), ...(unit ? { unit } : {}), ...(note ? { note } : {}) }
  })
}

const firstSentence = (text: string, max = 130): string => {
  const m = /^.*?[.!?](?=\s|$)/.exec(text)
  const s = (m ? m[0] : text).trim()
  return s.length > max ? `${s.slice(0, max - 3)}...` : s
}

const isEditorTool = (name: string) => name.startsWith('propose_') || NON_PROPOSE_EDITOR_TOOLS.includes(name)

/** Pure generator, exported for tests (they pass a registry with an extra fake tool). */
export function describeEditor(tools: readonly AssistantTool[], layoutMode: Mode, topic?: string) {
  const ops = tools.filter((t) => isEditorTool(t.name))
  const available = (name: string) => (OP_META[name]?.modes ?? BOTH).includes(layoutMode)

  const full = (t: AssistantTool) => {
    const meta = OP_META[t.name]
    return {
      tool: t.name,
      kind: t.name.startsWith('propose_') ? 'change (applied at once, with Undo; a delete waits for the typed confirmation)' : 'assistant action (changes nothing)',
      documented: !!meta,
      does: t.description,
      params: paramsOf(t),
      availableOnThisSite: available(t.name),
      ...(meta ? { area: meta.area, modes: meta.modes, needs: meta.needs, undoable: meta.undoable, qrReprint: meta.qrReprint, manualPath: meta.ui, explain: meta.explain } : {}),
    }
  }

  if (topic) {
    // Accept the operation with or without its tool prefix ("edit_parcel" → propose_edit_parcel).
    const want = topic.trim().toLowerCase()
    const one = ops.find((t) => t.name === want || t.name === `propose_${want}` || t.name.replace(/^propose_/, '') === want)
    if (one) return { ok: true, layoutMode, operation: full(one) }
    const areaOps = ops.filter((t) => (OP_META[t.name]?.area ?? 'site-tabs') === want)
    if (areaOps.length) return { ok: true, layoutMode, area: want, operations: areaOps.map((t) => ({ ...full(t), does: firstSentence(t.description, 220) })) }
    return { ok: false, error: 'unknown_topic', detail: `topic must be an operation (${ops.map((t) => t.name).join(', ')}) or an area (inventory, layout, site-tabs, media)` }
  }

  return {
    ok: true,
    layoutMode,
    howItWorks: 'Every change is APPLIED at once and shows as a done card with Undo (24 h unless noted); only deletes (not undoable) wait for the user to type DELETE on the card, with a ghost preview of what would go. Pass topic = an operation name for its full parameters, or an area name.',
    operations: ops.map((t) => {
      const meta = OP_META[t.name]
      return {
        tool: t.name,
        does: firstSentence(t.description),
        params: paramsOf(t).map((p) => `${p.name}${p.required ? '*' : ''}`),
        ...(meta
          ? { area: meta.area, modes: meta.modes.length === 2 ? 'both' : meta.modes[0], undoable: meta.undoable, qrReprint: meta.qrReprint, ...(available(t.name) ? {} : { availableOnThisSite: false }) }
          : { documented: false }),
      }
    }),
    manualOnly: MANUAL_ONLY.map((m) => ({ what: m.what, ui: m.ui, explain: m.explain })),
    seeAlso: 'explain_feature({topic}) for the UI how-to; get_parcel / list_parcels for current state; measure* tools for relative moves.',
  }
}

/** Every knowledge topic id the metadata points at (a test checks they exist). */
export function referencedKnowledgeTopics(): string[] {
  return [...new Set([...Object.values(OP_META).map((m) => m.explain), ...MANUAL_ONLY.map((m) => m.explain)].filter((x): x is string => !!x))]
}

export const editorProvider: InspectProvider = {
  name: 'editor',
  summary: 'What the inventory map + schematic editors (and site tabs) can do through the assistant: operations with parameters/units/ranges, preconditions, undo, QR-reprint impact, manual UI path. Generated from the registered propose tools.',
  examples: ['What can the schematic editor do?', 'Can I undo a delete?', 'Which changes need QR cards reprinted?', 'What are the limits of propose_edit_parcel?'],
  topics: 'an operation name (e.g. propose_move) or an area: inventory | layout | site-tabs | media',
  async describe(ctx, topic) {
    const [tools, mode] = await Promise.all([registeredTools(), siteLayoutMode(ctx.siteId)])
    return describeEditor(tools, mode, topic)
  },
}
