/**
 * GET /api/manage/grid?siteId=...&key=... — token-gated HTTP surface for the
 * manage floor's data assembly (track 024 P6.5). Mirrors what
 * `sites/[id]/manage/sunbeds/page.tsx` renders server-side, via the shared
 * `loadManageGrid` loader, so the React Native floor app (which cannot render
 * an RSC page) can fetch the same payload as plain JSON.
 *
 * Dates serialize to ISO strings via `Response.json` — the mobile client owns
 * parsing them back into Date-like values.
 */

import { NextRequest } from 'next/server'
import { loadManageGrid } from '@/app/sites/[id]/manage/load-grid'

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

  const result = await loadManageGrid(siteId, key)
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
      employees: result.employees,
      isAdmin: result.isAdmin,
    },
    { status: 200 },
  )
}
