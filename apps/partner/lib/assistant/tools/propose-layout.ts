/**
 * Schematic layout proposal tools (track 030 S4c): `propose_layout_elements` (add / update / delete
 * water, sand, deck, bar ... in schematic metres) and `propose_canvas_size`. Schematic sites only.
 * Elements are named by the short handles `list_layout_elements` returns, resolved to ids WITHIN the
 * site here; the model never supplies a cuid.
 */
import prisma from '@repo/data/PrismaCient'
import { ELEMENT_PRESETS } from '@/app/sites/[id]/schematic/palette'
import {
  layoutCanvasHandler, layoutElementsHandler,
  type CanvasPayload, type LayoutAdd, type LayoutElementsPayload, type LayoutPatch, type LayoutUpdate,
} from '../proposals/handlers/layout'
import { elementHandle } from './helpers'
import { proposeTool, type Plan } from './propose-core'

type Input = Record<string, unknown>
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const err = (...errors: string[]): { errors: string[] } => ({ errors })

export const MAX_ADD = 30
export const MAX_UPDATE = 50
export const MAX_DELETE = 30
const COORD = 10000
const HEX = /^#[0-9a-fA-F]{6}$/
const TYPES = Object.keys(ELEMENT_PRESETS)

const NOT_SCHEMATIC =
  'This site uses the Google Maps layout, not the schematic one: layout elements and the canvas size only exist on schematic sites. Sunbeds are edited on the map instead.'

async function schematicSite(siteId: string): Promise<boolean> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { layoutMode: true } })
  return site?.layoutMode === 'schematic'
}

/** Validates the numeric / text fields shared by add and update; returns the cleaned patch or an error. */
function readFields(raw: Record<string, unknown>, where: string): { fields: LayoutPatch & { width?: number; height?: number } } | { errors: string[] } {
  const f: LayoutPatch = {}
  for (const k of ['x', 'y'] as const) {
    if (raw[k] === undefined) continue
    if (!num(raw[k]) || Math.abs(raw[k] as number) > COORD) return err(`${where}: ${k} must be a number in metres`)
    f[k] = raw[k] as number
  }
  for (const [k, field] of [['w', 'width'], ['h', 'height']] as const) {
    if (raw[k] === undefined) continue
    if (!num(raw[k]) || (raw[k] as number) <= 0 || (raw[k] as number) > COORD) return err(`${where}: ${k} must be a positive size in metres`)
    f[field] = raw[k] as number
  }
  if (raw.rotation !== undefined) {
    if (!num(raw.rotation) || Math.abs(raw.rotation) > 360) return err(`${where}: rotation must be between -360 and 360 degrees`)
    f.rotation = raw.rotation
  }
  if (raw.label !== undefined) {
    if (raw.label !== null && (typeof raw.label !== 'string' || raw.label.length > 100)) return err(`${where}: label must be text of at most 100 characters`)
    f.label = raw.label === '' ? null : (raw.label as string | null)
  }
  if (raw.color !== undefined) {
    if (raw.color !== null && (typeof raw.color !== 'string' || !HEX.test(raw.color))) return err(`${where}: color must be a hex colour like #3b82f6`)
    f.color = raw.color as string | null
  }
  return { fields: f }
}

interface ElRef { id: string; type: string }

/** One short handle -> the element in THIS site. */
function resolveHandle(rows: ElRef[], handle: unknown, where: string): { id: string } | { errors: string[] } {
  if (typeof handle !== 'string' || handle.length < 3 || handle.length > 12) return err(`${where}: element must be a handle from list_layout_elements`)
  const hits = rows.filter((r) => elementHandle(r.id) === handle)
  if (hits.length === 0) return err(`${where}: no element "${handle}" in this site (call list_layout_elements for the handles)`)
  if (hits.length > 1) return err(`${where}: handle "${handle}" is ambiguous; ask the user which element they mean`)
  return { id: hits[0]!.id }
}

export async function planLayoutElements(siteId: string, input: Input): Promise<Plan<LayoutElementsPayload>> {
  if (!(await schematicSite(siteId))) return err(NOT_SCHEMATIC)
  const addIn = Array.isArray(input.add) ? input.add : []
  const updIn = Array.isArray(input.update) ? input.update : []
  const delIn = Array.isArray(input.delete) ? input.delete : []
  if (addIn.length + updIn.length + delIn.length === 0) return err('Give at least one element to add, update or delete')
  if (addIn.length > MAX_ADD || updIn.length > MAX_UPDATE || delIn.length > MAX_DELETE) {
    return err(`Too many elements at once (at most ${MAX_ADD} to add, ${MAX_UPDATE} to update, ${MAX_DELETE} to delete): split it into several proposals`)
  }
  if (delIn.length && addIn.length + updIn.length) return err('Deletions cannot be mixed with other changes: propose the deletion on its own (it cannot be undone)')

  const add: LayoutAdd[] = []
  for (const [i, raw] of addIn.entries()) {
    const where = `add[${i}]`
    if (!isObj(raw)) return err(`${where} must be an object`)
    const preset = typeof raw.type === 'string' ? ELEMENT_PRESETS[raw.type] : undefined
    if (!preset) return err(`${where}: type must be one of ${TYPES.join(', ')}`)
    if (raw.x === undefined || raw.y === undefined) return err(`${where}: x and y (top-left corner, metres) are required. Never invent them: ask the user where it goes`)
    const parsed = readFields(raw, where)
    if ('errors' in parsed) return parsed
    const f = parsed.fields
    add.push({
      type: preset.type, shape: preset.shape,
      x: f.x!, y: f.y!,
      width: f.width ?? preset.width, height: f.height ?? preset.height,
      rotation: f.rotation ?? 0,
      label: f.label ?? null, color: f.color ?? null,
    })
  }

  const needRows = updIn.length + delIn.length > 0
  const rows: ElRef[] = needRows ? await prisma.layoutElement.findMany({ where: { siteId }, select: { id: true, type: true } }) : []
  const seen = new Set<string>()
  const update: LayoutUpdate[] = []
  for (const [i, raw] of updIn.entries()) {
    const where = `update[${i}]`
    if (!isObj(raw)) return err(`${where} must be an object`)
    const ref = resolveHandle(rows, raw.element, where)
    if ('errors' in ref) return ref
    if (seen.has(ref.id)) return err(`${where}: element "${String(raw.element)}" appears twice`)
    seen.add(ref.id)
    const parsed = readFields(raw, where)
    if ('errors' in parsed) return parsed
    if (Object.keys(parsed.fields).length === 0) return err(`${where}: nothing to change`)
    update.push({ id: ref.id, patch: parsed.fields })
  }
  const del: Array<{ id: string }> = []
  for (const [i, raw] of delIn.entries()) {
    const where = `delete[${i}]`
    if (!isObj(raw)) return err(`${where} must be an object`)
    const ref = resolveHandle(rows, raw.element, where)
    if ('errors' in ref) return ref
    if (seen.has(ref.id)) return err(`${where}: element "${String(raw.element)}" appears twice`)
    seen.add(ref.id)
    del.push({ id: ref.id })
  }

  return { payload: { ...(add.length ? { add } : {}), ...(update.length ? { update } : {}), ...(del.length ? { del } : {}) } }
}

export async function planCanvasSize(siteId: string, input: Input): Promise<Plan<CanvasPayload>> {
  if (!(await schematicSite(siteId))) return err(NOT_SCHEMATIC)
  const { width_m: w, height_m: h } = input
  if (!num(w) || !num(h) || w < 5 || h < 5 || w > 500 || h > 500) return err('width_m and height_m must be between 5 and 500 metres')
  return { payload: { width: w, height: h } }
}

const SHAPE_FIELDS = {
  x: { type: 'number', description: 'Left edge in metres from the canvas origin (top-left)' },
  y: { type: 'number', description: 'Top edge in metres from the canvas origin (top-left)' },
  w: { type: 'number', description: 'Width in metres' },
  h: { type: 'number', description: 'Height in metres' },
  rotation: { type: 'number', description: 'Degrees, about the centre' },
  label: { type: ['string', 'null'], maxLength: 100 },
  color: { type: ['string', 'null'], description: 'Hex fill like #3b82f6; null = the type default' },
}

export const proposeLayoutElements = proposeTool<LayoutElementsPayload>({
  name: 'propose_layout_elements',
  label: 'Preparing layout changes',
  description:
    `Propose adding, changing or removing schematic LAYOUT ELEMENTS (the beach furniture drawn under the sunbeds) on a schematic-layout site. Types: ${TYPES.join(', ')}; omitted w/h use the type's default size. All positions are in schematic metres, x/y = the element's top-left corner (the same numbers list_layout_elements returns); the canvas is Site.layoutWidth x layoutHeight (call get_site_overview / list_layout_elements first, never guess where things are). To change or delete, name an element by its handle from list_layout_elements. Deletions must be proposed on their own and cannot be undone. Fails with an explanation on Google-Maps-layout sites.`,
  properties: {
    add: {
      type: 'array', maxItems: MAX_ADD,
      items: { type: 'object', properties: { type: { type: 'string', enum: TYPES }, ...SHAPE_FIELDS }, required: ['type', 'x', 'y'], additionalProperties: false },
    },
    update: {
      type: 'array', maxItems: MAX_UPDATE,
      items: { type: 'object', properties: { element: { type: 'string', minLength: 3, maxLength: 12 }, ...SHAPE_FIELDS }, required: ['element'], additionalProperties: false },
    },
    delete: {
      type: 'array', maxItems: MAX_DELETE,
      items: { type: 'object', properties: { element: { type: 'string', minLength: 3, maxLength: 12 } }, required: ['element'], additionalProperties: false },
    },
  },
  handler: layoutElementsHandler,
  plan: (input: Input, ctx) => planLayoutElements(ctx.siteId, input),
})

export const proposeCanvasSize = proposeTool<CanvasPayload>({
  name: 'propose_canvas_size',
  label: 'Preparing a canvas resize',
  description:
    'Propose resizing the schematic canvas (the world the elements and sunbeds are drawn in), in metres, 5 to 500 per side. Warns when existing elements or sunbeds would fall outside the new size. Schematic-layout sites only.',
  properties: {
    width_m: { type: 'number', minimum: 5, maximum: 500 },
    height_m: { type: 'number', minimum: 5, maximum: 500 },
  },
  required: ['width_m', 'height_m'],
  handler: layoutCanvasHandler,
  plan: (input: Input, ctx) => planCanvasSize(ctx.siteId, input),
})

export const layoutTools = [proposeLayoutElements, proposeCanvasSize]
