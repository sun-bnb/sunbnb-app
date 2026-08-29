import { API_URL } from './config'
import type { InventoryItem } from '@repo/floor-core/types'

/** The server-action response contract, unchanged over HTTP. */
export interface ActionResult {
  status: 'ok' | 'error'
  errors?: string[]
  [k: string]: unknown
}

export interface ManageContext {
  status: 'ok'
  site: { id: string; name: string }
  isAdmin: boolean
}

/**
 * Grid payload from GET /api/manage/grid. Dates arrive as ISO strings over
 * JSON; the floor logic (@repo/floor-core/bed-state) only reads statuses and
 * server-computed booleans, so string dates are safe there — format on render.
 */
export interface GridPayload {
  status: 'ok'
  site: {
    id: string
    name: string
    features?: string[] | null
    inventoryItems: InventoryItem[]
    [k: string]: unknown
  }
  employees: { id: string; name: string }[]
  isAdmin: boolean
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init)
  const body = (await res.json().catch(() => null)) as T | null
  if (body === null) throw new Error(`Bad response (${res.status})`)
  return body
}

export function isManageContext(r: ManageContext | ActionResult): r is ManageContext {
  return r.status === 'ok' && typeof (r as ManageContext).site?.id === 'string'
}

export function getManageContext(siteId: string, key: string) {
  return request<ManageContext | ActionResult>(
    `/api/manage/context?siteId=${encodeURIComponent(siteId)}&key=${encodeURIComponent(key)}`,
  )
}

export function getGrid(siteId: string, key: string) {
  return request<GridPayload | ActionResult>(
    `/api/manage/grid?siteId=${encodeURIComponent(siteId)}&key=${encodeURIComponent(key)}`,
  )
}

/**
 * Invoke a gated manage action through POST /api/manage/rpc. The action name
 * must be in the partner-side allowlist (rpc/registry.ts); every action
 * verifies the accessKey itself — pass it exactly where the action's
 * signature expects it.
 */
export function rpc<T extends ActionResult = ActionResult>(action: string, args: unknown[]) {
  return request<T>('/api/manage/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
}
