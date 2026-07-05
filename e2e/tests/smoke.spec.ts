import { test, expect } from '../fixtures'

// Smoke test: the user app boots and renders. Self-contained — no seeded DB data, repeatable.
// Proves the e2e harness works end-to-end: browser → mkcert HTTPS → navigation → assertion.
// Deeper flows (manage-grid reserve, booking) grow from here using support/manage.ts.

test('user app boots and renders the landing page', async ({ page, pageErrors }) => {
  await page.goto('/') // baseURL = user app (:3002)

  // The document rendered with a real title (app shell booted, not an error page).
  await expect(page).toHaveTitle(/.+/)

  // Hero <h1> renders (HomeView in apps/user/app/view.tsx). Don't pin text — it's i18n-translated.
  await expect(page.locator('h1').first()).toBeVisible()

  // Clean boot — no uncaught exceptions during load.
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([])
})
