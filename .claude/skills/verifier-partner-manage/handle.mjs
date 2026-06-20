// Reusable Playwright handle for browser-verifying the partner app's manage page.
// Solves the cold-start friction (playwright lives in the npx cache, not node_modules;
// mkcert self-signed HTTPS; the long-press multiselect mechanic). Import from a verify
// script:  import { openManage, multiselect, longPress } from '<this file>'
//
// Prereq once per machine (the skill's SKILL.md documents this):
//   npx -y playwright@1.61.0 install chromium      # ~90MB headless shell, into ~/Library/Caches/ms-playwright
//
// The partner dev server must be up:  cd apps/partner && source .env.local && npm run dev
//   → https://local.sunbnb.app:3001  (HTTPS via mkcert)

import { createRequire } from 'module'
import { execSync } from 'child_process'
const require = createRequire(import.meta.url)

// Playwright is usually in the npx cache (installed via `npx playwright`), NOT in the
// repo's node_modules — and ESM ignores NODE_PATH, so resolve it explicitly. CommonJS
// module, so default-import then destructure.
function resolveChromium() {
  try { return require('playwright').chromium } catch {}
  const found = execSync(
    `find "$HOME/.npm/_npx" -path '*playwright/index.js' 2>/dev/null | head -1`,
    { shell: '/bin/bash' },
  ).toString().trim()
  if (!found) {
    throw new Error('playwright not found. Run once: npx -y playwright@1.61.0 install chromium')
  }
  return require(found).chromium
}

export const chromium = resolveChromium()

export const MANAGE_BASE = 'https://local.sunbnb.app:3001'

/**
 * Launch a headless browser and open a token-gated manage page, cookie banner dismissed.
 * The manage page is session-less; auth is the ?key=<SecurityToken.id> query param.
 * Returns { browser, ctx, page }. Caller closes browser.
 */
export async function openManage(siteId, token, { width = 1100, height = 900 } = {}) {
  const browser = await chromium.launch() // headless shell uses ~/Library/Caches/ms-playwright by default
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height } }) // mkcert cert
  const page = await ctx.newPage()
  await page.goto(`${MANAGE_BASE}/sites/${siteId}/manage?key=${token}`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(2000)
  try { await page.getByRole('button', { name: 'OK' }).click({ timeout: 2500 }) } catch {} // cookie banner overlaps the bulk sheet
  return { browser, ctx, page }
}

/**
 * Long-press a seat by its visible "NNN-1" label to ENTER multiselect.
 * view.tsx LONG_PRESS_MS ≈ 450; hold 650ms to be safe. Must not move (pointer down→up, same spot).
 */
export async function longPress(page, label, ms = 650) {
  const el = page.getByText(label, { exact: true }).first()
  const b = await el.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up()
}

/** Multiselect a set of seats: long-press the first (enters multiselect), tap the rest to add. */
export async function multiselect(page, labels) {
  await longPress(page, labels[0]); await page.waitForTimeout(300)
  for (const l of labels.slice(1)) await page.getByText(l, { exact: true }).first().click()
  await page.waitForTimeout(300)
}

/** Compact one-line dump of the body text — cheap evidence/probe of current grid state. */
export async function bodyText(page, n = 300) {
  return (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, n)
}
