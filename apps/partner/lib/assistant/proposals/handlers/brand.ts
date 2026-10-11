/**
 * kinds `brand` and `slug` -- the Brand tab. Executed through the existing `saveBrand` (name /
 * tagline / colours) and `saveSlug` (public address). Both refuse the way the real actions do:
 * colour tokens are not writable under a live bespoke brand page (track 023 D2); the slug is.
 */
import prisma from '@repo/data/PrismaCient'
import { resolveBrandRender } from '@repo/data/brand-manifest'
import { saveBrand, saveSlug, checkSlug } from '@/app/sites/[id]/site-actions'
import { ProposalError, norm, type Change, type Diff, type HandlerCtx, type KindHandler, type Scalar } from '../types'

// ─── brand ──────────────────────────────────────────────────────────────────

export interface BrandPayload {
  fields: { brandName?: string; tagline?: string; bgColor?: string; fgColor?: string }
}
type BrandFields = BrandPayload['fields']
export interface BrandSnapshot {
  /** The brand row as it was, or null when the site had none (undo then removes the row). */
  brand: { brandName: string; tagline: string | null; bgColor: string | null; fgColor: string | null } | null
}

const COLOR = /^#[0-9a-fA-F]{3,8}$/
const BRAND_LABEL: Record<keyof BrandFields, string> = {
  brandName: 'Brand name', tagline: 'Tagline', bgColor: 'Background colour', fgColor: 'Text colour',
}

export function planBrand(input: Record<string, unknown>): { payload: BrandPayload } | { errors: string[] } {
  const errors: string[] = []
  const fields: BrandFields = {}
  if (input.brandName !== undefined) {
    const v = String(input.brandName).trim()
    if (!v) errors.push('Brand name cannot be empty')
    else if (v.length > 200) errors.push('Brand name is too long (max 200)')
    else fields.brandName = v
  }
  if (input.tagline !== undefined) {
    const v = String(input.tagline).trim()
    if (v.length > 500) errors.push('Tagline is too long (max 500)')
    else fields.tagline = v
  }
  for (const key of ['bgColor', 'fgColor'] as const) {
    if (input[key] === undefined) continue
    const v = String(input[key]).trim()
    if (!COLOR.test(v)) errors.push(`${BRAND_LABEL[key]} must be a hex colour like #faf9f6`)
    else fields[key] = v
  }
  if (errors.length === 0 && Object.keys(fields).length === 0) errors.push('Nothing to change: give at least one field')
  return errors.length ? { errors } : { payload: { fields } }
}

async function loadBrand(siteId: string) {
  const [site, brand] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId }, select: { slug: true, customBrandEnabled: true, customBrandKey: true } }),
    prisma.siteBrand.findUnique({ where: { siteId } }),
  ])
  if (!site) throw new ProposalError('Site not found')
  return { site, brand }
}

export const brandHandler: KindHandler<BrandPayload, BrandSnapshot> = {
  kind: 'brand',

  async diff(ctx: HandlerCtx, payload): Promise<Diff> {
    const { site, brand } = await loadBrand(ctx.siteId)
    if (resolveBrandRender(site).mode === 'custom') {
      throw new ProposalError('This site uses a custom brand page: its appearance is set in code, not in the Brand tab, so I cannot change it')
    }
    const cur: Record<keyof BrandFields, Scalar> = {
      brandName: brand?.brandName ?? null, tagline: brand?.tagline ?? null,
      bgColor: brand?.bgColor ?? null, fgColor: brand?.fgColor ?? null,
    }
    if (!brand && !payload.fields.brandName) {
      throw new ProposalError('This site has no brand yet: a brand name is required to create it')
    }
    const changes: Change[] = []
    for (const key of Object.keys(payload.fields) as (keyof BrandFields)[]) {
      const after = payload.fields[key] ?? null
      if (norm(cur[key]) === norm(after)) continue
      changes.push({ target: 'Brand', field: key, label: BRAND_LABEL[key], before: cur[key], after })
    }
    return { changes }
  },

  async snapshot(ctx) {
    const { brand } = await loadBrand(ctx.siteId)
    return {
      brand: brand
        ? { brandName: brand.brandName, tagline: brand.tagline ?? null, bgColor: brand.bgColor ?? null, fgColor: brand.fgColor ?? null }
        : null,
    }
  },

  async execute(ctx, payload, done) {
    const { site, brand } = await loadBrand(ctx.siteId)
    const f = payload.fields
    const r = await saveBrand({
      siteId: ctx.siteId,
      brandName: f.brandName ?? brand?.brandName ?? '',
      slug: site.slug ?? '',
      tagline: 'tagline' in f ? (f.tagline ?? '') : (brand?.tagline ?? ''),
      bgColor: 'bgColor' in f ? (f.bgColor ?? '') : (brand?.bgColor ?? ''),
      fgColor: 'fgColor' in f ? (f.fgColor ?? '') : (brand?.fgColor ?? ''),
    })
    if (r.status !== 'ok') throw new ProposalError(r.errors?.[0] ?? 'Brand update failed')
    done.push('brand')
  },

  async restore(ctx, _payload, snapshot) {
    const { site, brand } = await loadBrand(ctx.siteId)
    if (!snapshot.brand) {
      // The apply created the row; no existing action deletes one, so remove it here (ownership was
      // re-verified by the engine before restore runs).
      if (brand) await prisma.siteBrand.delete({ where: { siteId: ctx.siteId } })
      return
    }
    const r = await saveBrand({
      siteId: ctx.siteId,
      brandName: snapshot.brand.brandName,
      slug: site.slug ?? '',
      tagline: snapshot.brand.tagline ?? '',
      bgColor: snapshot.brand.bgColor ?? '',
      fgColor: snapshot.brand.fgColor ?? '',
    })
    if (r.status !== 'ok') throw new ProposalError(r.errors?.[0] ?? 'Brand restore failed')
  },
}

// ─── slug ───────────────────────────────────────────────────────────────────

export interface SlugPayload { slug: string }
export interface SlugSnapshot { slug: string | null }

/** Same normalisation as `validateSlug` in site-actions. */
export const normalizeSlug = (raw: string): string => raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')

export async function planSlug(input: Record<string, unknown>, siteId: string): Promise<{ payload: SlugPayload; warnings: string[] } | { errors: string[] }> {
  if (typeof input.slug !== 'string') return { errors: ['slug is required'] }
  const slug = normalizeSlug(input.slug)
  if (slug.length < 3) return { errors: ['The address must have at least 3 letters, digits or dashes'] }
  if (slug.length > 60) return { errors: ['The address must be at most 60 characters'] }
  const { available } = await checkSlug(slug, siteId)
  if (!available) return { errors: [`The address "${slug}" is already taken by another site; suggest a different one`] }
  const warnings: string[] = []
  if (slug !== input.slug.trim()) warnings.push(`The address was cleaned up to "${slug}" (lowercase letters, digits and dashes only)`)
  return { payload: { slug }, warnings }
}

export const slugHandler: KindHandler<SlugPayload, SlugSnapshot> = {
  kind: 'slug',

  async diff(ctx, payload): Promise<Diff> {
    const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { slug: true } })
    if (!site) throw new ProposalError('Site not found')
    if ((site.slug ?? null) === payload.slug) return { changes: [] }
    return {
      changes: [{ target: 'Site', field: 'slug', label: 'Public address', before: site.slug ?? null, after: payload.slug }],
      warnings: ['Anyone using the old address will no longer reach the booking page'],
    }
  },

  async snapshot(ctx) {
    const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { slug: true } })
    return { slug: site?.slug ?? null }
  },

  async execute(ctx, payload, done) {
    const r = await saveSlug(ctx.siteId, payload.slug)
    if (r.status !== 'ok') throw new ProposalError(r.errors?.[0] ?? 'Public address update failed')
    done.push('slug')
  },

  async restore(ctx, _payload, snapshot) {
    const r = await saveSlug(ctx.siteId, snapshot.slug ?? '')
    if (r.status !== 'ok') throw new ProposalError(r.errors?.[0] ?? 'Public address restore failed')
  },
}
