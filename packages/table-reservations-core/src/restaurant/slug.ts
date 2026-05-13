import prisma from '@repo/data/PrismaCient'

/** URL-safe slug — lowercase, dashes, strips diacritics. Non-empty fallback. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return base || 'restaurant'
}

/**
 * Returns a slug derived from `source` that is not currently taken by any
 * existing Restaurant. On collision, appends `-2`, `-3`, ... until free.
 * `exceptId` lets an update request keep its own slug without colliding with
 * itself.
 */
export async function uniqueRestaurantSlug(
  source: string,
  exceptId?: string,
): Promise<string> {
  const base = slugify(source)
  let candidate = base
  let suffix = 2
  while (true) {
    const existing = await prisma.restaurant.findUnique({
      where: { slug: candidate },
      select: { id: true },
    })
    if (!existing || existing.id === exceptId) return candidate
    candidate = `${base}-${suffix++}`
  }
}
