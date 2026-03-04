/**
 * Shared Auth Utilities for API Routes
 *
 * Provides ownership verification for resources (reservations, orders).
 * Supports both authenticated users (session.user.id) and anonymous users (anonId).
 *
 * Anonymous users pass their anonId via:
 * - Query parameter: ?anonId=xxx (for GET requests)
 * - Request body: { anonId: "xxx" } (for POST requests)
 */

import { auth } from '@/app/auth'
import { NextRequest } from 'next/server'

export interface RequestIdentity {
  userId?: string
  anonId?: string
}

/**
 * Extract the requesting user's identity from session or anonId parameter.
 * Returns null if no identity could be established.
 */
export async function getRequestIdentity(
  request: NextRequest,
  bodyAnonId?: string
): Promise<RequestIdentity | null> {
  const session = await auth()

  if (session?.user?.id) {
    return { userId: session.user.id }
  }

  // For anonymous users: check body param first, then query param
  const anonId = bodyAnonId ?? request.nextUrl.searchParams.get('anonId')
  if (anonId) {
    return { anonId }
  }

  return null
}

/**
 * Verify that the requesting user owns a resource.
 * A resource is owned if either:
 * - The authenticated user's ID matches the resource's userId
 * - The anonymous user's anonId matches the resource's anonId
 */
export function verifyOwnership(
  identity: RequestIdentity,
  resource: { userId: string; anonId?: string | null }
): boolean {
  if (identity.userId) {
    return identity.userId === resource.userId
  }
  if (identity.anonId && resource.anonId) {
    return identity.anonId === resource.anonId
  }
  return false
}
