/**
 * GET /api/manage/context?siteId=...&key=... — thin token-verification route
 * (track 024 P6.5). This is what the mobile pairing screen calls to confirm a
 * scanned access key is valid before storing it, without pulling the whole
 * manage grid payload.
 */

import { NextRequest } from 'next/server'
import { validateManageToken } from '@/app/sites/[id]/manage/token'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const siteId = searchParams.get('siteId')
  const key = searchParams.get('key') ?? undefined

  if (!siteId) {
    return Response.json(
      { status: 'error', errors: ['`siteId` query parameter is required'] },
      { status: 400 },
    )
  }

  const result = await validateManageToken(siteId, key)
  if (!result.ok) {
    return Response.json(
      { status: 'error', errors: [result.error.message] },
      { status: 401 },
    )
  }

  return Response.json(
    {
      status: 'ok',
      site: result.site,
      isAdmin: result.isAdmin,
    },
    { status: 200 },
  )
}
