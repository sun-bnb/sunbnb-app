/**
 * The `layoutElements` fields a consumer page must load for a schematic site.
 * `SchematicSelection` draws these surfaces (pool, sand, bar…) under the beds;
 * a site query that omits them renders bare seats on a blank canvas. Shared by
 * every page that can mount the booking surface (`/sites/[id]`, `/s/[slug]`).
 */
export const LAYOUT_ELEMENT_SELECT = {
  id: true,
  type: true,
  shape: true,
  x: true,
  y: true,
  width: true,
  height: true,
  rotation: true,
  z: true,
  label: true,
  color: true,
  cornerRadius: true,
} as const
