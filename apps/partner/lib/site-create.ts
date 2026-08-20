/**
 * Site creation with a minted `Site.code` (track 022).
 *
 * Every site needs the external code the printed QR URL is built from
 * (`/q/S-K7M2X9/1-1-1`), and the partner app has TWO creation paths — the
 * 4-step wizard (`sites/create/actions.ts`) and the single-form `submitForm`
 * (`sites/[id]/site-actions.ts`). They existed independently long before this
 * column; routing both through here is what stops a site being created without
 * a code by whichever path someone forgets.
 *
 * The invariant is app-local by choice, not enforced in `packages/data`: the
 * value is random per row, so no DB default or trigger can supply it. The
 * backfill script (`backfill:site-codes:*`) is idempotent and re-runnable, and
 * is the net under this.
 */

import prisma from '@repo/data/PrismaCient'
import { generateSiteCode, isSiteCodeCollision } from '@repo/data/site-code'

type SiteCreateData = Parameters<typeof prisma.site.create>[0]['data']

/**
 * Five is plenty: at 32^6 a first-attempt collision is ~1 in 10^9 per existing
 * site, so needing even a second attempt means something else is wrong.
 */
const MAX_ATTEMPTS = 5

export async function createSiteWithCode(data: SiteCreateData) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Mint INSIDE the loop — a retry with the same code would collide forever.
      return await prisma.site.create({ data: { ...data, code: generateSiteCode() } })
    } catch (err) {
      // Only a code clash is retryable. Retrying another unique violation (a
      // `restaurantId` already linked, say) would burn the attempts and then
      // surface the same error five times later, having hidden the real cause
      // from the operator in the meantime.
      if (!isSiteCodeCollision(err) || attempt === MAX_ATTEMPTS) throw err
    }
  }
  /* c8 ignore next 2 */
  // Unreachable: the loop either returns or rethrows on its final attempt.
  throw new Error('createSiteWithCode: exhausted attempts without resolving')
}
