import { test as base, expect } from '@playwright/test'

// Shared fixtures for the e2e layer. Specs import `test` / `expect` from HERE, not from
// `@playwright/test` directly, so every test gets the cookie-banner dismiss and the
// uncaught-error collector for free.

type Fixtures = {
  // Uncaught exceptions thrown by the page during the test. Assert this stays empty for a
  // clean boot. Preferred over asserting zero console.error, which is noisy on Next dev.
  pageErrors: string[]
}

export const test = base.extend<Fixtures>({
  pageErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await use(errors)
  },

  // Auto-dismiss the cookie banner once the first navigation has happened — mirrors
  // handle.mjs openApp(): best-effort click on the "OK" button, swallow if it's not there.
  page: async ({ page }, use) => {
    const dismissCookie = async () => {
      // Banner copy changed over time ("OK" → "Decline / Accept all"). Decline
      // is the privacy-preserving default for automated runs.
      for (const name of ['Decline', 'OK']) {
        try {
          await page.getByRole('button', { name, exact: true }).click({ timeout: 1500 })
          return
        } catch {
          /* try next label / banner absent */
        }
      }
    }
    page.on('load', () => void dismissCookie())
    await use(page)
  },
})

export { expect }
