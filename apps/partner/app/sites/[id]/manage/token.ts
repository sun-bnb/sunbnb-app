/**
 * Shared token gate for all token-gated manage sub-routes (landing, sunbeds, summary).
 *
 * Encapsulates SecurityToken validation so each page just calls this and handles
 * the ok:false case by rendering an ErrorCard. Returns the minimal site fields
 * (id, name) the landing needs so callers don't re-query for basics.
 */

import prisma from '@repo/data/PrismaCient'

export type ValidateManageTokenResult =
  | {
      ok: true
      token: { id: string; resources: string[] }
      isAdmin: boolean
      site: { id: string; name: string }
    }
  | { ok: false; error: { title: string; message: string } }

/**
 * Validates a SecurityToken for the manage surface.
 *
 * Checks:
 *   - token exists, is unexpired, has `all` or `manage_site` in resources
 *   - the site exists
 *   - the token's userId matches the site's userId (cross-site key rejection)
 *
 * Returns the token, an `isAdmin` flag (token carries 'admin' in resources),
 * and the minimal site shape { id, name } so callers can render the site name
 * without an extra query.
 */
export async function validateManageToken(
  siteId: string,
  key: string | undefined
): Promise<ValidateManageTokenResult> {
  if (!key) {
    return {
      ok: false,
      error: {
        title: 'Missing access key',
        message:
          'No access key was provided. Please use the link given to you by the site operator.',
      },
    }
  }

  const securityToken = await prisma.securityToken.findUnique({
    where: {
      id: key,
      expires: { gt: new Date() },
      resources: { hasSome: ['all', 'manage_site'] },
    },
  })

  if (!securityToken) {
    return {
      ok: false,
      error: {
        title: 'Invalid or expired access key',
        message:
          'This access key is no longer valid. Please contact the site operator to get a new link.',
      },
    }
  }

  const site = await prisma.site.findFirst({
    where: { id: siteId },
    select: { id: true, name: true, userId: true },
  })

  if (!site) {
    return {
      ok: false,
      error: {
        title: 'Site not found',
        message:
          'This site does not exist or has been removed. Please contact the site operator.',
      },
    }
  }

  if (site.userId !== securityToken.userId) {
    return {
      ok: false,
      error: {
        title: 'Not authorized',
        message:
          'This access key is not valid for this site. Please contact the site operator.',
      },
    }
  }

  const isAdmin = (securityToken.resources as string[]).includes('admin')

  return {
    ok: true,
    token: { id: securityToken.id, resources: securityToken.resources as string[] },
    isAdmin,
    site: { id: site.id, name: site.name },
  }
}
