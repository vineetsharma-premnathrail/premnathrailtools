import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'

// One-time sign-in for the layout tests: opens a visible browser on /login,
// waits (up to 5 minutes) while you finish Microsoft sign-in, then saves the
// session cookie to e2e/.auth/state.json for `npm run test:ui:layout`.
test('sign in and save the session', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  await page.goto('/login')
  await page.waitForURL(/\/dashboard/, { timeout: 5 * 60_000 })
  mkdirSync('e2e/.auth', { recursive: true })
  await page.context().storageState({ path: 'e2e/.auth/state.json' })
})
