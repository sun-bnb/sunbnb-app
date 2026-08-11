// Reusable Playwright handle for browser-verifying the Sunbnb apps (partner / user).
// Absorbs the cold-start friction so a verify script doesn't re-derive it:
//   - playwright lives in the npx cache, not node_modules; ESM ignores NODE_PATH
//   - mkcert self-signed HTTPS needs ignoreHTTPSErrors
//   - a cookie banner overlaps the bottom UI
//
// Usage from a verify script:
//   import { openApp, openManage, longPress, multiselect, bodyText, APPS } from '<this file>'
//
// Prereq once per machine:  npx -y playwright@1.61.0 install chromium
// The target app must be running:  cd apps/<app> && source .env.local && npm run dev

import { createRequire } from 'module'
import { execSync } from 'child_process'
const require = createRequire(import.meta.url)

// Playwright is usually in the npx cache (installed via `npx playwright`), NOT in the repo's
// node_modules — and ESM ignores NODE_PATH, so resolve it explicitly. CommonJS → default-import.
function resolveChromium() {
  try { return require('playwright').chromium } catch {}
  const found = execSync(
    `find "$HOME/.npm/_npx" -path '*playwright/index.js' 2>/dev/null | head -1`,
    { shell: '/bin/bash' },
  ).toString().trim()
  if (!found) throw new Error('playwright not found. Run once: npx -y playwright@1.61.0 install chromium')
  return require(found).chromium
}

export const chromium = resolveChromium()

// All three apps run under the same mkcert host, different ports.
export const APPS = {
  partner: 'https://local.sunbnb.app:3001',
  user:    'https://local.sunbnb.app:3002',
  admin:   'https://local.sunbnb.app:3003',
}

/**
 * Launch a headless browser and open `app` at `path`. Generic across all three apps.
 * Returns { browser, ctx, page }; caller closes browser. ignoreHTTPSErrors handles mkcert.
 */
export async function openApp(app, path, { width = 1100, height = 900, dismissCookie = true } = {}) {
  const base = APPS[app]
  if (!base) throw new Error(`unknown app '${app}' — one of ${Object.keys(APPS).join(', ')}`)
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height } })
  const page = await ctx.newPage()
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(2000)
  if (dismissCookie) { try { await page.getByRole('button', { name: 'OK' }).click({ timeout: 2500 }) } catch {} }
  return { browser, ctx, page }
}

// ── Partner manage page (token-gated, session-less; ?key=<SecurityToken.id>) ────────────

/**
 * Open the partner manage SUNBED GRID for a site with its access token.
 * The bare /manage route is a token-gated LANDING (links to sub-routes) since
 * the manage split — the drivable seat grid lives at /manage/sunbeds.
 */
export function openManage(siteId, token, opts) {
  return openApp('partner', `/sites/${siteId}/manage/sunbeds?key=${token}`, opts)
}

/**
 * Long-press a manage-grid seat (by its "NNN-1" label) to ENTER multiselect.
 * view.tsx LONG_PRESS_MS ≈ 450; hold 650ms. Must not move (pointer down→up, same spot).
 */
export async function longPress(page, label, ms = 650) {
  const el = page.getByText(label, { exact: true }).first()
  const b = await el.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up()
}

/** Multiselect manage-grid seats: long-press the first (enters multiselect), tap the rest. */
export async function multiselect(page, labels) {
  await longPress(page, labels[0]); await page.waitForTimeout(300)
  for (const l of labels.slice(1)) await page.getByText(l, { exact: true }).first().click()
  await page.waitForTimeout(300)
}

// ── Generic helpers ─────────────────────────────────────────────────────────────────────

/** Compact one-line dump of the body text — cheap evidence/probe of current UI state. */
export async function bodyText(page, n = 300) {
  return (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, n)
}
