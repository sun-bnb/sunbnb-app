/**
 * POST /api/manage/rpc — token-gated HTTP surface for the manage floor
 * (track 024 P6.5). The React Native floor app cannot call Next server
 * actions, so it POSTs `{ action, args }` here and this route forwards the
 * call to the matching entry in `RPC_ACTIONS` (registry.ts) and returns the
 * result verbatim.
 *
 * This route carries NO auth logic of its own — it is a pure forwarder. Every
 * action in the allowlist already takes an `accessKey` argument and verifies
 * it server-side (`verifySiteOwnership` / `verifySiteAdmin`), so the existing
 * auth-rejection matrix (`app/test/gated-actions.ts` + `auth-matrix.test.ts`)
 * keeps covering every call this route can make. Do not add auth checks here
 * — that would create a SECOND gate that can silently drift from the first.
 */

import { NextRequest } from 'next/server'
import { RPC_ACTIONS } from './registry'

const MAX_ARGS = 20

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { status: 'error', errors: ['Request body must be valid JSON'] },
      { status: 400 },
    )
  }

  if (!body || typeof body !== 'object') {
    return Response.json(
      { status: 'error', errors: ['Request body must be a JSON object'] },
      { status: 400 },
    )
  }

  const { action, args } = body as { action?: unknown; args?: unknown }

  if (typeof action !== 'string' || !action) {
    return Response.json(
      { status: 'error', errors: ['`action` must be a non-empty string'] },
      { status: 400 },
    )
  }

  if (!Array.isArray(args)) {
    return Response.json(
      { status: 'error', errors: ['`args` must be an array'] },
      { status: 400 },
    )
  }

  if (args.length > MAX_ARGS) {
    return Response.json(
      { status: 'error', errors: [`\`args\` may not exceed ${MAX_ARGS} elements`] },
      { status: 400 },
    )
  }

  const handler = RPC_ACTIONS[action]
  if (!handler) {
    return Response.json(
      { status: 'error', errors: [`Unknown action: ${action}`] },
      { status: 400 },
    )
  }

  try {
    const result = await handler(...args)
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    // Mirrors the THROW-NORMALISATION note in app/test/gated-actions.ts — a
    // handful of underlying actions throw Error() instead of returning
    // { status: 'error' }. Normalise here too so RPC callers get one shape.
    const message = e instanceof Error ? e.message : String(e)
    return Response.json({ status: 'error', errors: [message] }, { status: 200 })
  }
}
