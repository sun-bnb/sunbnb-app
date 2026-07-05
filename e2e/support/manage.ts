import type { Page } from '@playwright/test'

// Partner manage-grid driving helpers, ported from the verifier-sunbnb skill's handle.mjs so
// the next e2e test (manage-grid reserve → DB assert) can reuse them under the runner instead
// of re-deriving the grid mechanics. NOT exercised by the smoke test yet — staged for growth.
//
// The manage page is token-gated and session-less:  /sites/<siteId>/manage?key=<SecurityToken.id>
// Seats render as "NNN-1" labelled <div>s; parcel tabs are text (not buttons); multiselect is a
// long-press on the first seat (enters multiselect), then taps on the rest.

const PARTNER_APP = 'https://local.sunbnb.app:3001'

/** Build the token-gated manage URL for a site. */
export function manageUrl(siteId: string, token: string): string {
  return `${PARTNER_APP}/sites/${siteId}/manage?key=${token}`
}

/**
 * Long-press a manage-grid seat (by its "NNN-1" label) to ENTER multiselect.
 * view.tsx LONG_PRESS_MS ≈ 450; hold 650ms. Must not move (pointer down → up, same spot).
 */
export async function longPress(page: Page, label: string, ms = 650): Promise<void> {
  const el = page.getByText(label, { exact: true }).first()
  const b = await el.boundingBox()
  if (!b) throw new Error(`seat label not found: ${label}`)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

/** Multiselect manage-grid seats: long-press the first (enters multiselect), tap the rest. */
export async function multiselect(page: Page, labels: string[]): Promise<void> {
  await longPress(page, labels[0])
  await page.waitForTimeout(300)
  for (const l of labels.slice(1)) {
    await page.getByText(l, { exact: true }).first().click()
  }
  await page.waitForTimeout(300)
}
